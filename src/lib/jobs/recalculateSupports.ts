import { config } from "@/lib/config";
import { addSymbol, listSymbols, removeSymbol } from "@/lib/db/symbols";
import { replaceSupports, supportAsOfBySymbol } from "@/lib/db/supports";
import { lastCompletedSession } from "@/lib/market/calendar";
import { stockProvider } from "@/lib/stock";
import { computeSupports } from "@/lib/support/calculate";

/** ~1 trading year: MA200 needs 200 bars, Fibonacci scans 120. */
const HISTORY_BARS = 260;

export interface RecalcSummary {
  session: string;
  updated: string[];
  skipped: string[];
  errors: Record<string, string>;
  /** Symbols still to do after this call (per-minute API limit); the caller should pause and call again. */
  remaining: number;
  /** Offset to pass on the next call when `force` is used. */
  next: number;
}

/**
 * Recompute support levels for `symbols` and store them, at most `apiCreditsPerMinute`
 * symbols per call. Without `force`, symbols that are already current are skipped, so
 * repeated calls converge. With `force`, `offset` walks through the list instead.
 * The still-forming current-day bar is dropped: only sessions that finished
 * (per the NYSE calendar) feed the calculation.
 */
export async function recalculate(symbols: string[], now: Date, opts: { force?: boolean; offset?: number } = {}): Promise<RecalcSummary> {
  const session = lastCompletedSession(now);
  const offset = opts.force ? Math.max(0, opts.offset ?? 0) : 0;
  const summary: RecalcSummary = { session, updated: [], skipped: [], errors: {}, remaining: 0, next: offset };

  const cached = opts.force ? {} : await supportAsOfBySymbol();
  const todo = opts.force ? symbols.slice(offset) : symbols.filter((s) => (cached[s] ?? "") < session);
  summary.skipped = symbols.filter((s) => !opts.force && !todo.includes(s));
  const batch = todo.slice(0, config.apiCreditsPerMinute());
  summary.remaining = todo.length - batch.length;
  summary.next = offset + batch.length;
  if (batch.length === 0) return summary;

  const history = await stockProvider.getDailyCandles(batch, HISTORY_BARS);
  Object.assign(summary.errors, history.errors);

  for (const [symbol, candles] of Object.entries(history.data)) {
    try {
      const completed = candles.filter((c) => c.date <= session);
      const result = computeSupports(completed);
      await replaceSupports(symbol, result.asOf, result.refClose, result.tiers);
      summary.updated.push(symbol);
    } catch (err) {
      summary.errors[symbol] = err instanceof Error ? err.message : String(err);
    }
  }
  return summary;
}

export async function recalculateAll(now: Date, opts: { force?: boolean; offset?: number } = {}): Promise<RecalcSummary> {
  return recalculate(await listSymbols(), now, opts);
}

/**
 * Start tracking a symbol. The symbol is only kept if its history could be
 * fetched and support levels computed, which also validates the ticker.
 */
export async function trackSymbol(symbol: string, now: Date): Promise<{ ok: true } | { ok: false; error: string }> {
  const created = await addSymbol(symbol);
  try {
    const summary = await recalculate([symbol], now, { force: true });
    if (summary.updated.includes(symbol)) return { ok: true };
    if (created) await removeSymbol(symbol);
    return { ok: false, error: summary.errors[symbol] ?? "could not calculate support levels" };
  } catch (err) {
    if (created) await removeSymbol(symbol);
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
