import { config } from "@/lib/config";
import { formatAlertMessages, formatLateMessages, type AlertItem, type LateItem } from "@/lib/alerts/format";
import { evaluateTier, sameScale } from "@/lib/alerts/evaluate";
import { claimAlert, loadStates, recordAlerts, rearm, releaseAlert, stateKey } from "@/lib/db/alerts";
import { lastRunDay, markRun } from "@/lib/db/jobRuns";
import { listSupports } from "@/lib/db/supports";
import { listSymbols } from "@/lib/db/symbols";
import { formatDateTime } from "@/lib/format/datetime";
import { isMarketOpen, isWithinWindowAfterOpen, MARKET_TZ, nyToday } from "@/lib/market/calendar";
import { getQuotes, warmQuotes } from "./quotes";
import { notify, recipients } from "./notify";

export interface CheckSummary {
  skipped?: SkipReason | "no_symbols";
  checked: number;
  quotesFetched: number;
  quotesCached: number;
  alerts: string[];
  rearmed: string[];
  errors: Record<string, string>;
  /** Alerts held back because nobody is subscribed yet. */
  noRecipients?: boolean;
}

const timeLabel = (now: Date) => `${formatDateTime(now, MARKET_TZ)} (เวลานิวยอร์ก)`;

/**
 * "intraday": run every ~30 min while the market is open, judge by current price.
 * "daily" (what the workflow uses): a few fixed checks a day, and today's low so far counts as a touch.
 *   - 10:30 ET, an hour after the open (21:30-22:30 in Thailand, while the user is still up; the open is
 *     when prices swing most)
 *   - 13:30 ET, mid-session
 *   The after-close pass in the evening recalculation covers touches after the last one.
 *   Each check is accepted from its time until the next one (the last until the close): GitHub's scheduled runs
 *   are often 15-60 min late. The first complete run of a check records it for the day, so the other UTC cron
 *   candidate (DST) or a late duplicate does nothing. A tier alerted by an earlier check is not alerted again
 *   before the price bounces (its state is claimed), so a second check only sends new touches.
 */
export type CheckMode = "intraday" | "daily";
/** minutes after the 09:30 open, earliest first */
const DAILY_CHECKS = [60, 240];
const DAILY_LAST_WINDOW_MIN = 150; // 13:30 -> 16:00

/** Which daily check `now` belongs to, as its job_runs key ("daily-check-1030"), or null outside all of them. */
export function dailyCheckSlot(now: Date): string | null {
  for (let i = DAILY_CHECKS.length - 1; i >= 0; i--) {
    const start = DAILY_CHECKS[i];
    const window = i + 1 < DAILY_CHECKS.length ? DAILY_CHECKS[i + 1] - start : DAILY_LAST_WINDOW_MIN;
    if (isWithinWindowAfterOpen(now, start, window)) {
      const t = 9 * 60 + 30 + start;
      return `daily-check-${String(Math.floor(t / 60)).padStart(2, "0")}${String(t % 60).padStart(2, "0")}`;
    }
  }
  return null;
}

const WARM_BUDGET_MS = 200_000;

type SkipReason = "market_closed" | "outside_daily_window" | "already_checked_today";

/** Why a run should do nothing right now (shared by the quote-warming and check endpoints). */
export async function skipReason(now: Date, { force, mode }: { force?: boolean; mode?: CheckMode }): Promise<SkipReason | undefined> {
  if (force) return undefined;
  if (!isMarketOpen(now)) return "market_closed";
  if (mode !== "daily") return undefined;
  const slot = dailyCheckSlot(now);
  if (!slot) return "outside_daily_window";
  // if the bookkeeping is unavailable, better check twice than not at all (alerts are claimed, never sent twice)
  if ((await lastRunDay(slot).catch(() => null)) === nyToday(now)) return "already_checked_today";
  return undefined;
}

/**
 * Why a quote must not be compared with the stored levels: its previous close is on another scale than the close the
 * levels came from. That is a split since the last recalculation (a 10-for-1 split would read as a 90% fall through
 * every level), or bad data. The evening recalculation rebuilds the levels on the new scale.
 */
export function quoteDoubt(refClose: number, prevClose: number | undefined): string | null {
  if (prevClose !== undefined && !sameScale(prevClose, refClose)) {
    return `previous close ${prevClose} vs ${refClose} the levels were computed from (split?): skipped until the next recalculation`;
  }
  return null;
}

/** One tick: quote every tracked symbol, compare with cached levels, push LINE alerts. */
export async function checkAlerts(now: Date, opts: { force?: boolean; mode?: CheckMode } = {}): Promise<CheckSummary> {
  const daily = opts.mode === "daily";
  const summary: CheckSummary = { checked: 0, quotesFetched: 0, quotesCached: 0, alerts: [], rearmed: [], errors: {} };

  const skipped = await skipReason(now, opts);
  if (skipped) return { ...summary, skipped };

  const result = await runCheck(now, daily, summary);
  // Only a complete daily run counts: if some quotes could not be fetched, the other cron candidate tries again
  // (already-sent alerts are not repeated, their tiers are claimed).
  const slot = daily && !opts.force ? dailyCheckSlot(now) : null;
  if (slot && Object.keys(result.quoteErrors).length === 0) {
    await markRun(slot, nyToday(now)).catch((e) => console.error("could not record the daily check", e));
  }
  return result.summary;
}

async function runCheck(now: Date, daily: boolean, summary: CheckSummary): Promise<{ summary: CheckSummary; quoteErrors: Record<string, string> }> {
  let quoteErrors: Record<string, string> = {};
  const out = (s: CheckSummary) => ({ summary: s, quoteErrors });

  const symbols = await listSymbols();
  if (symbols.length === 0) return out({ ...summary, skipped: "no_symbols" });
  // All quotes first, in per-minute batches (a no-op when the workflow already warmed them); 200 s of the route's 300 s.
  await warmQuotes(symbols, WARM_BUDGET_MS);

  const [supports, states, quotes] = await Promise.all([listSupports(), loadStates(), getQuotes(symbols, now)]);
  summary.quotesFetched = quotes.fetched;
  summary.quotesCached = quotes.cached;
  quoteErrors = { ...quotes.errors };
  summary.errors = quotes.errors;
  summary.checked = Object.keys(quotes.prices).length;

  const pending: { item: AlertItem; previousAlertAt: Date | null }[] = [];

  const alertTiers = config.alertTiers();
  for (const s of supports) {
    if (!alertTiers.includes(s.tier)) continue;
    const price = quotes.prices[s.symbol];
    if (price === undefined) continue;
    const doubt = quoteDoubt(s.refClose, quotes.prevCloses[s.symbol]);
    if (doubt) {
      summary.errors[s.symbol] = doubt;
      continue;
    }
    const state = states.get(stateKey(s.symbol, s.tier));

    const decision = evaluateTier({ price, level: s.price, state, now, low: daily ? quotes.lows[s.symbol] : undefined });
    if (decision === "rearm") {
      await rearm(s.symbol, s.tier);
      summary.rearmed.push(`${s.symbol}:${s.tier}`);
    } else if (decision === "alert") {
      if (await claimAlert(s.symbol, s.tier)) {
        pending.push({
          item: {
            symbol: s.symbol,
            tier: s.tier,
            method: s.method,
            price,
            level: s.price,
            dayLow: daily ? quotes.lows[s.symbol] : undefined,
          },
          previousAlertAt: state?.lastAlertAt ?? null,
        });
      }
    }
  }
  if (pending.length === 0) return out(summary);

  // Don't burn alerts (and re-arm state) while nobody can receive them.
  if ((await recipients()).length === 0) {
    for (const p of pending) await releaseAlert(p.item.symbol, p.item.tier, p.previousAlertAt);
    return out({ ...summary, noRecipients: true });
  }

  try {
    await notify(formatAlertMessages(pending.map((p) => p.item), timeLabel(now)));
  } catch (err) {
    for (const p of pending) await releaseAlert(p.item.symbol, p.item.tier, p.previousAlertAt);
    throw err;
  }

  await recordAlerts(pending.map((p) => p.item));
  summary.alerts = pending.map((p) => `${p.item.symbol}:${p.item.tier}`);
  return out(summary);
}

/**
 * Push the after-close summary (see src/lib/alerts/lateCheck.ts). A missed touch claims its tier like a live alert,
 * so the next check does not send it again and the tier re-arms after a bounce as usual. A break is sent once: the
 * recalculation that finds it also replaces the level, and a later run has no new bars to compare.
 * Returns what was sent, as "SYM:tier:touch|break".
 */
export async function deliverLateAlerts(events: LateItem[]): Promise<string[]> {
  if (events.length === 0) return [];
  const states = await loadStates();
  const claimed: { item: LateItem; previousAlertAt: Date | null }[] = [];
  const toSend: LateItem[] = [];
  for (const e of events) {
    const previousAlertAt = states.get(stateKey(e.symbol, e.tier))?.lastAlertAt ?? null;
    let item = e;
    if (e.missedTouch) {
      if (await claimAlert(e.symbol, e.tier)) claimed.push({ item: e, previousAlertAt });
      else item = { ...e, missedTouch: false }; // someone else alerted it meanwhile
    }
    if (item.missedTouch || item.broke) toSend.push(item);
  }
  const release = () => Promise.all(claimed.map((c) => releaseAlert(c.item.symbol, c.item.tier, c.previousAlertAt)));
  if (toSend.length === 0) return [];
  if ((await recipients()).length === 0) {
    await release();
    return [];
  }
  try {
    await notify(formatLateMessages(toSend));
  } catch (err) {
    await release();
    throw err;
  }
  await recordAlerts(claimed.map(({ item }) => ({ symbol: item.symbol, tier: item.tier, method: item.method, price: item.close, level: item.level })));
  return toSend.map((e) => `${e.symbol}:${e.tier}:${e.broke ? "break" : "touch"}`);
}
