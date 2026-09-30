import { fibonacciRetracement } from "./fibonacci";
import { sma } from "./movingAverage";
import { swingZones } from "./swing";
import type { Candle, Method, SupportCandidate, SupportResult, Tier, TieredSupport } from "./types";
import { TIERS } from "./types";

/**
 * Bump when the levels a given price history produces change (methods, tiers, parameters). Stored with every level;
 * levels from another version are recalculated on the next run instead of waiting for a new trading day.
 * 1 = daily pivots + MA + swing low + Fibonacci; 2 = structural only (swing zones, MA, Fibonacci).
 */
export const SUPPORT_LOGIC_VERSION = 2;

/** Bars the live system feeds in: every indicator only looks at the last ones (MA200 needs 200, swing zones scan 250). */
export const SUPPORT_BARS = 260;

/** Minimum history needed to say anything useful. MA50/MA200 are skipped if shorter than their period. */
const MIN_CANDLES = 30;

/** Two tiers must be at least this fraction apart, otherwise the lower one is pushed further down. */
const MIN_TIER_GAP = 0.01;

/**
 * Only structural levels: ones that stay put from day to day (a price where it actually bounced, a long average,
 * a retracement of a fixed swing). Daily pivots were dropped: rebuilt from one day's bar, they followed the price
 * down every day, and the backtest found touching them was no better than buying on any other day.
 *
 *  - minor        nearest structural level below the price
 *  - intermediate the next one
 *  - major        long-term anchors (MA200 / Fib 61.8%); failing those, a zone the price bounced from twice or more
 */
const TIER_METHODS: Record<Tier, Method[]> = {
  minor: ["swing_low", "ma50", "fib_382", "fib_500"],
  intermediate: ["swing_low", "fib_500", "ma50", "fib_382"],
  major: ["ma200", "fib_618"],
};
const MAJOR_FALLBACK_TOUCHES = 2;

/** Gather every support candidate from the structural techniques (unfiltered). */
function collectCandidates(candles: Candle[]): SupportCandidate[] {
  const last = candles[candles.length - 1];
  const out: SupportCandidate[] = [];

  const ma50 = sma(candles, 50);
  if (ma50 !== null) out.push({ method: "ma50", price: ma50 });
  const ma200 = sma(candles, 200);
  if (ma200 !== null) out.push({ method: "ma200", price: ma200 });

  // Zones where the price turned up before. When the price is already inside one, the line left to watch is its bottom.
  for (const z of swingZones(candles)) {
    if (z.low >= last.close) continue;
    out.push({ method: "swing_low", price: z.high < last.close ? z.high : z.low, zoneLow: z.low, touches: z.touches });
  }

  const fib = fibonacciRetracement(candles);
  if (fib) {
    out.push(
      { method: "fib_382", price: fib.fib382 },
      { method: "fib_500", price: fib.fib500 },
      { method: "fib_618", price: fib.fib618 },
    );
  }

  return out.filter((c) => Number.isFinite(c.price) && c.price > 0);
}

/**
 * Compute tiered support levels from daily candles (oldest -> newest).
 * The caller must pass only *completed* sessions.
 */
export function computeSupports(candles: Candle[]): SupportResult {
  if (candles.length < MIN_CANDLES) {
    throw new Error(`Need at least ${MIN_CANDLES} daily candles, got ${candles.length}`);
  }
  const last = candles[candles.length - 1];
  const refClose = last.close;

  const candidates = collectCandidates(candles)
    .filter((c) => c.price < refClose)
    .sort((a, b) => b.price - a.price);

  const tiers: TieredSupport[] = [];
  let limit = refClose;

  for (const tier of TIERS) {
    const below = candidates.filter((c) => c.price < limit);
    const pick =
      pickFrom(below, TIER_METHODS[tier]) ??
      (tier === "major" ? below.find((c) => c.method === "swing_low" && (c.touches ?? 0) >= MAJOR_FALLBACK_TOUCHES) : undefined) ??
      below[0]; // last resort: nearest level from any method
    if (!pick) break;

    tiers.push({ ...pick, tier });
    limit = Math.min(pick.price, pick.zoneLow ?? pick.price) * (1 - MIN_TIER_GAP);
  }

  return { asOf: last.date, refClose, candidates, tiers };
}

/** Highest-priced candidate (list is already sorted desc) whose method is allowed. */
function pickFrom(sortedDesc: SupportCandidate[], methods: Method[]): SupportCandidate | undefined {
  return sortedDesc.find((c) => methods.includes(c.method));
}
