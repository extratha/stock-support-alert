import { fibonacciRetracement } from "./fibonacci";
import { sma } from "./movingAverage";
import { classicPivot } from "./pivot";
import { findSwingLows } from "./swing";
import type { Candle, Method, SupportCandidate, SupportResult, Tier, TieredSupport } from "./types";
import { TIERS } from "./types";

/** Minimum history needed to say anything useful. MA50/MA200 are skipped if shorter than their period. */
const MIN_CANDLES = 30;

/** Two tiers must be at least this fraction apart, otherwise the lower one is pushed further down. */
const MIN_TIER_GAP = 0.005;

/**
 * Which methods feed which tier, in the order of the spec:
 *  - minor        nearest support to price (short-term)
 *  - intermediate mid-range structure
 *  - major        long-term anchors; Pivot S3 is only a fallback because a
 *                 single-day pivot is short-lived compared to MA200 / Fib 61.8%
 */
const TIER_METHODS: Record<Tier, Method[]> = {
  minor: ["pivot_s1", "ma50", "fib_382"],
  intermediate: ["pivot_s2", "swing_low", "fib_500"],
  major: ["ma200", "fib_618"],
};
const TIER_FALLBACK: Partial<Record<Tier, Method[]>> = {
  major: ["pivot_s3"],
};

/** Gather every support candidate from all four techniques (unfiltered). */
function collectCandidates(candles: Candle[]): SupportCandidate[] {
  const last = candles[candles.length - 1];
  const out: SupportCandidate[] = [];

  const pivot = classicPivot(last);
  out.push(
    { method: "pivot_s1", price: pivot.s1 },
    { method: "pivot_s2", price: pivot.s2 },
    { method: "pivot_s3", price: pivot.s3 },
  );

  const ma50 = sma(candles, 50);
  if (ma50 !== null) out.push({ method: "ma50", price: ma50 });
  const ma200 = sma(candles, 200);
  if (ma200 !== null) out.push({ method: "ma200", price: ma200 });

  // Most recent confirmed swing low that sits below the last close.
  const swing = findSwingLows(candles)
    .filter((c) => c.low < last.close)
    .at(-1);
  if (swing) out.push({ method: "swing_low", price: swing.low });

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
 * The caller must pass only *completed* sessions; the last candle is treated
 * as "the previous day" for the pivot calculation.
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
  const used = new Set<Method>();
  let limit = refClose;

  for (const tier of TIERS) {
    const below = candidates.filter((c) => c.price < limit && !used.has(c.method));
    const pick =
      pickFrom(below, TIER_METHODS[tier]) ??
      pickFrom(below, TIER_FALLBACK[tier] ?? []) ??
      below[0]; // last resort: nearest unused level from any method
    if (!pick) break;

    tiers.push({ tier, method: pick.method, price: pick.price });
    used.add(pick.method);
    limit = pick.price * (1 - MIN_TIER_GAP);
  }

  return { asOf: last.date, refClose, candidates, tiers };
}

/** Highest-priced candidate (list is already sorted desc) whose method is allowed. */
function pickFrom(sortedDesc: SupportCandidate[], methods: Method[]): SupportCandidate | undefined {
  return sortedDesc.find((c) => methods.includes(c.method));
}
