import { DEFAULT_RULES, evaluateTier, type TierState } from "@/lib/alerts/evaluate";
import { computeSupports } from "@/lib/support/calculate";
import type { Candle, Method, Tier } from "@/lib/support/types";

/**
 * Walk-forward backtest of the ACTUAL support logic (computeSupports + evaluateTier), day by day.
 *
 * No look-ahead: on day d the levels are computed from candles up to day d-1 only (exactly what the live
 * system has: it recalculates after the previous close). A "touch" is decided by evaluateTier with the same
 * tolerance / re-arm buffer as the live alerts, using the day's low and close.
 */
export const HORIZONS = [5, 20, 60] as const;
export type Horizon = (typeof HORIZONS)[number];

/** Live system feeds ~260 bars into the calculation; every indicator only looks at the last N bars, so this matches. */
export const SUPPORT_WINDOW = 260;
/** First day evaluated: MA200 needs 200 prior bars. */
export const WARMUP_BARS = 200;
/** "A real drop": a close this far below the entry within 20 trading days. */
export const DRAWDOWN_LEVEL = 0.03;
const DD_DAYS = 20;

export type Outcome = {
  /** the stock's return over the 5 trading days BEFORE the entry close (how hard it had just fallen); null at the very start */
  prev5: number | null;
  /** return from entry to the close `H` trading days after the touch day; null if the data ends first */
  ret: Record<Horizon, number | null>;
  /** worst low in the next 20 days relative to entry (negative = how far it fell); null if data ends first */
  mae20: number | null;
  /** did any close within the next 20 days end >= 3% below entry? */
  fell3: boolean | null;
};

export interface TouchEvent {
  symbol: string;
  date: string;
  tier: Tier;
  method: Method;
  level: number;
  /** (a) bought at the close of the touch day (what you can do after seeing an alert) */
  atClose: Outcome;
  /** (b) limit order at the level: filled only if the day's low reached it (price = min(level, open)); null = not filled */
  atLevel: Outcome | null;
}

export interface DaySample extends Outcome {
  symbol: string;
  date: string;
  /** close relative to the highest high of the last 60 days (0 = at the peak, -0.1 = 10% below it) */
  fromHigh60: number;
}

/** "Near the peak" for the buy-at-the-top comparison: close within this fraction of the 60-day high. */
export const NEAR_PEAK = 0.03;

/** Outcome of buying at `entry` on day `d` (entry happens during/at the close of day d). */
export function outcomeFrom(candles: Candle[], d: number, entry: number, includeEntryDayLow: boolean): Outcome {
  const n = candles.length;
  const ret = {} as Record<Horizon, number | null>;
  for (const h of HORIZONS) ret[h] = d + h < n ? candles[d + h].close / entry - 1 : null;

  const prev5 = d >= 5 ? candles[d].close / candles[d - 5].close - 1 : null;
  if (d + DD_DAYS >= n) return { prev5, ret, mae20: null, fell3: null };
  let low = Infinity;
  let fell3 = false;
  for (let i = includeEntryDayLow ? d : d + 1; i <= d + DD_DAYS; i++) low = Math.min(low, candles[i].low);
  for (let i = d + 1; i <= d + DD_DAYS; i++) if (candles[i].close < entry * (1 - DRAWDOWN_LEVEL)) fell3 = true;
  return { prev5, ret, mae20: low / entry - 1, fell3 };
}

/** Every alert the live rules would have fired for this symbol over its history. */
export function findTouchEvents(symbol: string, candles: Candle[]): TouchEvent[] {
  const events: TouchEvent[] = [];
  const states = new Map<Tier, TierState>();

  for (let d = WARMUP_BARS; d < candles.length; d++) {
    const today = candles[d];
    const known = candles.slice(Math.max(0, d - SUPPORT_WINDOW), d); // up to yesterday: no look-ahead
    const { tiers } = computeSupports(known);
    const now = new Date(`${today.date}T20:00:00Z`);

    for (const t of tiers) {
      const state = states.get(t.tier);
      const decision = evaluateTier({ price: today.close, level: t.price, state, now, low: today.low }, DEFAULT_RULES);
      if (decision === "rearm") {
        states.set(t.tier, { armed: true, lastAlertAt: state?.lastAlertAt ?? null });
      } else if (decision === "alert") {
        states.set(t.tier, { armed: false, lastAlertAt: now });
        const fills = today.low <= t.price;
        events.push({
          symbol,
          date: today.date,
          tier: t.tier,
          method: t.method,
          level: t.price,
          atClose: outcomeFrom(candles, d, today.close, false),
          atLevel: fills ? outcomeFrom(candles, d, Math.min(t.price, today.open), true) : null,
        });
      }
    }
  }
  return events;
}

/** The yardstick: buying at the close of EVERY eligible day of the same stock. */
export function baselineSamples(symbol: string, candles: Candle[]): DaySample[] {
  const samples: DaySample[] = [];
  for (let d = WARMUP_BARS; d < candles.length; d++) {
    let high60 = candles[d].high;
    for (let i = Math.max(0, d - 60); i < d; i++) high60 = Math.max(high60, candles[i].high);
    samples.push({ symbol, date: candles[d].date, fromHigh60: candles[d].close / high60 - 1, ...outcomeFrom(candles, d, candles[d].close, false) });
  }
  return samples;
}
