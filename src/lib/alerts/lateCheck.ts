import type { Candle, Method, Tier } from "@/lib/support/types";
import { DEFAULT_RULES, sameScale } from "./evaluate";

/**
 * The after-close pass. The live check runs once a day (13:30 New York) and compares the price with levels fixed
 * the evening before. Anything after that run slipped through: a fall to the level late in the day, or a close
 * below it. The next recalculation then drops a level the price closed under and shows a lower one, so without this
 * pass nobody would hear that the old level was touched or broke.
 *
 * Runs in the evening recalculation, on the finished bars (full-day low and close) that the old levels never saw.
 */
export interface PreviousLevel {
  tier: Tier;
  method: Method;
  price: number;
  zoneLow: number | null;
  /** the last bar these levels were computed from, and its close */
  asOf: string;
  refClose: number;
}

export interface LateEvent {
  symbol: string;
  tier: Tier;
  method: Method;
  level: number;
  zoneLow: number | null;
  /** first new day whose low reached the level */
  date: string;
  /** lowest low and last close of the new days */
  low: number;
  close: number;
  /** touched and no alert went out for it (the tier was still armed) */
  missedTouch: boolean;
  /** closed under the level (under the bottom of a swing zone): the recalculation drops it */
  broke: boolean;
}

export function findLateEvents(
  symbol: string,
  previous: PreviousLevel[],
  candles: Candle[],
  { tiers, isArmed, tolerance = DEFAULT_RULES.touchTolerance }: { tiers: Tier[]; isArmed: (tier: Tier) => boolean; tolerance?: number },
): LateEvent[] {
  const events: LateEvent[] = [];
  for (const p of previous) {
    if (!tiers.includes(p.tier)) continue;
    // the provider rescaled its history (split) since the levels were computed: old and new prices don't compare
    const known = candles.find((c) => c.date === p.asOf);
    if (known && !sameScale(known.close, p.refClose)) continue;
    const fresh = candles.filter((c) => c.date > p.asOf);
    const touch = fresh.find((c) => c.low <= p.price * (1 + tolerance));
    if (!touch) continue;
    const close = fresh[fresh.length - 1].close;
    const missedTouch = isArmed(p.tier);
    const broke = close < (p.zoneLow ?? p.price);
    if (!missedTouch && !broke) continue; // the live check already alerted and the level held: nothing new to say
    events.push({
      symbol,
      tier: p.tier,
      method: p.method,
      level: p.price,
      zoneLow: p.zoneLow,
      date: touch.date,
      low: Math.min(...fresh.map((c) => c.low)),
      close,
      missedTouch,
      broke,
    });
  }
  return events;
}
