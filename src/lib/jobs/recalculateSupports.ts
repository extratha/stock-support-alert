import { config } from "@/lib/config";
import { addSymbol, listSymbols, removeSymbol } from "@/lib/db/symbols";
import { saveHistoryStats } from "@/lib/db/profiles";
import { loadStates, stateKey } from "@/lib/db/alerts";
import { listSupports, replaceSupports, replaceSupportTests, supportAsOfBySymbol } from "@/lib/db/supports";
import { lastCompletedSession } from "@/lib/market/calendar";
import { stockProvider } from "@/lib/stock";
import { historyStats } from "@/lib/profile/history";
import { computeSupports, SUPPORT_BARS } from "@/lib/support/calculate";
import { trackLevels } from "@/lib/support/track";
import { findLateEvents } from "@/lib/alerts/lateCheck";
import type { LateItem } from "@/lib/alerts/format";
import { deliverLateAlerts } from "./checkAlerts";
import { ensureLogo } from "./logos";
import { refreshFundamentals } from "./profiles";

/**
 * ~5 years of daily bars. Twelve Data charges per symbol per request, not per bar, so this costs the same as one year.
 * The support levels only look at the last SUPPORT_BARS; the full history is used for the "worst fall" risk figure
 * and to replay how this stock's levels behaved in the past (held or broke).
 */
const HISTORY_BARS = 1300;

export interface RecalcSummary {
  session: string;
  updated: string[];
  skipped: string[];
  errors: Record<string, string>;
  /** Symbols still to do after this call (per-minute API limit); the caller should pause and call again. */
  remaining: number;
  /** Offset to pass on the next call when `force` is used. */
  next: number;
  /** After-close summary pushed to LINE ("SYM:tier:touch|break"), see src/lib/alerts/lateCheck.ts */
  lateAlerts?: string[];
  lateAlertsError?: string;
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

  // The levels as they were before this run, to see what the finished session did to them (never blocks the recalculation).
  const [previous, states] = await Promise.all([listSupports(), loadStates()]).catch(() => [[], new Map()] as const);
  const alertTiers = config.alertTiers();
  const late: LateItem[] = [];

  for (const [symbol, candles] of Object.entries(history.data)) {
    try {
      const completed = candles.filter((c) => c.date <= session);
      const result = computeSupports(completed.slice(-SUPPORT_BARS));
      const events = findLateEvents(symbol, previous.filter((p) => p.symbol === symbol), completed, {
        tiers: alertTiers,
        isArmed: (tier) => states.get(stateKey(symbol, tier))?.armed ?? true,
      });
      await replaceSupports(symbol, result.asOf, result.refClose, result.tiers);
      for (const e of events) {
        const next = result.tiers.find((t) => t.tier === e.tier);
        late.push({ ...e, next: next ? { price: next.price, method: next.method } : null });
      }
      const stats = historyStats(completed);
      if (stats) await saveHistoryStats(symbol, stats).catch((e) => console.error("history stats failed", symbol, e));
      await replaceSupportTests(symbol, trackLevels(completed)).catch((e) => console.error("level history failed", symbol, e));
      summary.updated.push(symbol);
    } catch (err) {
      summary.errors[symbol] = err instanceof Error ? err.message : String(err);
    }
  }
  try {
    const sent = await deliverLateAlerts(late);
    if (sent.length > 0) summary.lateAlerts = sent;
  } catch (err) {
    summary.lateAlertsError = err instanceof Error ? err.message : String(err);
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
    if (summary.updated.includes(symbol)) {
      // The logo is fetched once, now, and kept in the DB. Best effort and bounded: adding the symbol never
      // fails or waits long because of it (the daily job fills in any that are still missing).
      await ensureLogo(symbol, { deadlineMs: 6000 });
      await refreshFundamentals({ symbols: [symbol], deadlineMs: 6000 }); // bounded, never throws
      return { ok: true };
    }
    if (created) await removeSymbol(symbol);
    return { ok: false, error: summary.errors[symbol] ?? "could not calculate support levels" };
  } catch (err) {
    if (created) await removeSymbol(symbol);
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
