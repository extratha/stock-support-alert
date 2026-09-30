import { DEFAULT_RULES } from "@/lib/alerts/evaluate";
import { computeSupports, SUPPORT_BARS } from "./calculate";
import type { Candle, Method, Tier } from "./types";
import { TIERS } from "./types";

/**
 * Did the levels hold? Replays the live logic over a stock's own history, day by day with no look-ahead (the levels
 * for day d come from bars up to d-1, as the live system has them), and follows every touch of a level:
 *
 *   touch   = the day's low comes within the alert tolerance of the level, like a live alert
 *   held    = a close (that day's or later) at least `bounce` above the level
 *   broken  = a close more than `breakBelow` under the level (under the bottom of a swing zone) before that
 *   unclear = neither within `maxDays` trading days
 *
 * "Held" alone proves nothing (a close above the level on the touch day is already part of the way up), so each
 * test also carries `expectedHeld`: how often the same rule holds for an arbitrary level at the same distance.
 *
 * The level is frozen at the price it had when touched. That is the point: if the next day's recalculation drops
 * it and shows a lower one, the old level still counts as broken instead of silently disappearing.
 */
export type TestOutcome = "held" | "broken" | "unclear" | "open";

export interface LevelTest {
  tier: Tier;
  method: Method;
  level: number;
  zoneLow: number | null;
  touches: number | null;
  touchedOn: string;
  outcome: TestOutcome;
  /** the day it held / broke / ran out of time; null while still open */
  resolvedOn: string | null;
  /**
   * The yardstick: the share of "held" when the same distance below the previous close is used as a level on every
   * other day of this stock that touched it (same rule). A level is only worth something if it holds more often than
   * this. null when there was nothing to compare with.
   */
  expectedHeld: number | null;
}

export const TRACK_RULES = { touchTolerance: DEFAULT_RULES.touchTolerance, bounce: 0.03, breakBelow: 0.03, maxDays: 20 };
type Rules = typeof TRACK_RULES;

/** First day replayed: MA200 needs 200 prior bars. */
const WARMUP = 200;

/** What happened to a level touched on day `d` (that day's close counts). `day` = when it was decided. */
function resolve(candles: Candle[], d: number, level: number, floor: number, rules: Rules): { outcome: TestOutcome; day: number | null } {
  const last = Math.min(candles.length - 1, d + rules.maxDays);
  for (let i = d; i <= last; i++) {
    if (candles[i].close < floor) return { outcome: "broken", day: i };
    if (candles[i].close >= level * (1 + rules.bounce)) return { outcome: "held", day: i };
  }
  return d + rules.maxDays < candles.length ? { outcome: "unclear", day: d + rules.maxDays } : { outcome: "open", day: null };
}

/** Held share of the same geometry (level and floor as fractions of the previous close) on every other touching day. */
function matchedHeld(candles: Candle[], d: number, level: number, floor: number, rules: Rules): number | null {
  const ratio = level / candles[d - 1].close;
  const floorRatio = floor / level;
  let held = 0;
  let n = 0;
  for (let e = WARMUP; e < candles.length; e++) {
    if (e === d) continue;
    const l = candles[e - 1].close * ratio;
    if (candles[e].low > l * (1 + rules.touchTolerance)) continue;
    const { outcome } = resolve(candles, e, l, l * floorRatio, rules);
    if (outcome === "open") continue;
    n++;
    if (outcome === "held") held++;
  }
  return n > 0 ? held / n : null;
}

export function trackLevels(candles: Candle[], rules = TRACK_RULES): LevelTest[] {
  const tests: LevelTest[] = [];
  /** a tier is not tested again until its current test is decided */
  const busyUntil = new Map<Tier, number>();

  for (let d = WARMUP; d < candles.length; d++) {
    const bar = candles[d];
    const { tiers } = computeSupports(candles.slice(Math.max(0, d - SUPPORT_BARS), d));
    for (const t of tiers) {
      if ((busyUntil.get(t.tier) ?? -1) >= d || bar.low > t.price * (1 + rules.touchTolerance)) continue;
      const floor = Math.min(t.price, t.zoneLow ?? t.price) * (1 - rules.breakBelow);
      const { outcome, day } = resolve(candles, d, t.price, floor, rules);
      tests.push({
        tier: t.tier,
        method: t.method,
        level: t.price,
        zoneLow: t.zoneLow ?? null,
        touches: t.touches ?? null,
        touchedOn: bar.date,
        outcome,
        resolvedOn: day === null ? null : candles[day].date,
        expectedHeld: outcome === "open" ? null : matchedHeld(candles, d, t.price, floor, rules),
      });
      busyUntil.set(t.tier, day ?? Infinity);
    }
  }
  return tests;
}

export interface TierRecord {
  held: number;
  broken: number;
  unclear: number;
  /** how many would have held at the matched baseline rate (sum of expectedHeld over the counted tests) */
  expectedHeld: number;
}

/** Resolved tests per tier (open ones are not counted yet). */
export function tierRecords(tests: Pick<LevelTest, "tier" | "outcome" | "expectedHeld">[]): Record<Tier, TierRecord> {
  const out = Object.fromEntries(TIERS.map((t) => [t, { held: 0, broken: 0, unclear: 0, expectedHeld: 0 }])) as Record<Tier, TierRecord>;
  for (const t of tests) {
    if (t.outcome === "open" || t.expectedHeld === null) continue;
    out[t.tier][t.outcome]++;
    out[t.tier].expectedHeld += t.expectedHeld;
  }
  return out;
}

/** What the dashboard shows for one stock (plain data, safe to pass to client components). */
export interface TrackSummary {
  records: Record<Tier, TierRecord>;
  /** the most recent level that broke, if that happened within RECENT_BREAK_DAYS */
  recentBreak: Pick<LevelTest, "tier" | "method" | "level" | "zoneLow" | "touchedOn" | "resolvedOn"> | null;
  /** first touch replayed (start of the record) */
  since: string | null;
}

const RECENT_BREAK_DAYS = 30;

/** `today` = New York date YYYY-MM-DD. */
export function summarizeTrack(tests: LevelTest[], today: string): TrackSummary {
  const cutoff = new Date(Date.parse(`${today}T00:00:00Z`) - RECENT_BREAK_DAYS * 86_400_000).toISOString().slice(0, 10);
  const lastBreak = tests
    .filter((t) => t.outcome === "broken" && t.resolvedOn !== null && t.resolvedOn >= cutoff)
    .sort((a, b) => (a.resolvedOn! < b.resolvedOn! ? -1 : 1))
    .at(-1);
  return {
    records: tierRecords(tests),
    recentBreak: lastBreak
      ? { tier: lastBreak.tier, method: lastBreak.method, level: lastBreak.level, zoneLow: lastBreak.zoneLow, touchedOn: lastBreak.touchedOn, resolvedOn: lastBreak.resolvedOn }
      : null,
    since: tests.reduce<string | null>((min, t) => (min === null || t.touchedOn < min ? t.touchedOn : min), null),
  };
}

