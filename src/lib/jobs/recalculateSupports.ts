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
}

/**
 * Recompute support levels for `symbols` and store them.
 * The still-forming current-day bar is dropped: only sessions that finished
 * (per the NYSE calendar) feed the calculation.
 */
export async function recalculate(symbols: string[], now: Date, opts: { force?: boolean } = {}): Promise<RecalcSummary> {
  const session = lastCompletedSession(now);
  const summary: RecalcSummary = { session, updated: [], skipped: [], errors: {} };

  const cached = opts.force ? {} : await supportAsOfBySymbol();
  const todo = symbols.filter((s) => (cached[s] ?? "") < session);
  summary.skipped = symbols.filter((s) => !todo.includes(s));
  if (todo.length === 0) return summary;

  const history = await stockProvider.getDailyCandles(todo, HISTORY_BARS);
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

export async function recalculateAll(now: Date, opts: { force?: boolean } = {}): Promise<RecalcSummary> {
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
