import { describe, expect, it } from "vitest";
import { computeSupports } from "./calculate";
import { summarizeTrack, tierRecords, trackLevels, type LevelTest } from "./track";
import type { Candle } from "./types";

const date = (i: number) => new Date(Date.UTC(2024, 0, 1 + i)).toISOString().slice(0, 10);
const bar = (i: number, close: number, low = close, high = close): Candle => ({ date: date(i), open: close, high, low, close, volume: 1 });

// smooth rise: every level sits below the price, so nothing is touched until the bars appended by each test
const rise = Array.from({ length: 260 }, (_, i) => bar(i, 100 + i * 0.5));
const minor = computeSupports(rise).tiers.find((t) => t.tier === "minor")!;
const L = minor.price;
const after = (...closes: [number, number?][]) => [...rise, ...closes.map(([c, low], k) => bar(260 + k, c, low ?? c))];
const testOn = (candles: Candle[], i: number) => trackLevels(candles).find((t) => t.touchedOn === date(i) && t.tier === "minor")!;

describe("trackLevels", () => {
  it("nothing is touched while the price stays above every level", () => {
    expect(trackLevels(rise)).toEqual([]);
  });

  it("held: after the touch, a close 3% above the level comes first", () => {
    const t = testOn(after([L * 1.01, L], [L * 1.04]), 260);
    expect(t).toMatchObject({ method: minor.method, level: L, outcome: "held", resolvedOn: date(261) });
  });

  it("broken: a close more than 3% under the level comes first, and the level stays the one that was touched", () => {
    const candles = after([L * 1.005, L], [L * 0.95]);
    const t = testOn(candles, 260);
    expect(t).toMatchObject({ level: L, outcome: "broken", resolvedOn: date(261) });
    // the next day's calculation no longer offers that level, but the record keeps it
    expect(computeSupports(candles).tiers.some((x) => x.price === L)).toBe(false);
  });

  it("unclear after 20 trading days of neither; open while still undecided", () => {
    expect(testOn(after([L * 1.01, L], ...Array.from({ length: 20 }, (): [number] => [L * 1.01])), 260).outcome).toBe("unclear");
    expect(testOn(after([L * 1.01, L]), 260)).toMatchObject({ outcome: "open", resolvedOn: null });
  });
});

describe("summaries", () => {
  const t = (tier: LevelTest["tier"], outcome: LevelTest["outcome"], touchedOn: string, resolvedOn: string | null): LevelTest => ({
    tier, outcome, touchedOn, resolvedOn, method: "ma50", level: 100, zoneLow: null, touches: null, expectedHeld: outcome === "open" ? null : 0.5,
  });

  it("counts resolved tests per tier, leaving open ones out", () => {
    const r = tierRecords([t("minor", "held", "a", "b"), t("minor", "broken", "a", "b"), t("minor", "open", "a", null), t("major", "unclear", "a", "b")]);
    expect(r.minor).toEqual({ held: 1, broken: 1, unclear: 0, expectedHeld: 1 });
    expect(r.major).toEqual({ held: 0, broken: 0, unclear: 1, expectedHeld: 0.5 });
  });

  it("reports the latest break only if it happened within the last 30 days", () => {
    const tests = [t("minor", "broken", "2026-08-01", "2026-08-03"), t("major", "broken", "2026-09-10", "2026-09-12"), t("minor", "held", "2026-09-20", "2026-09-22")];
    expect(summarizeTrack(tests, "2026-09-30")).toMatchObject({ recentBreak: { tier: "major", resolvedOn: "2026-09-12" }, since: "2026-08-01" });
    expect(summarizeTrack(tests, "2026-12-31").recentBreak).toBeNull();
    expect(summarizeTrack([], "2026-09-30")).toMatchObject({ recentBreak: null, since: null });
  });
});

describe("expectedHeld (the yardstick)", () => {
  it("on a random walk (where no level can be real) levels hold about as often as the yardstick says", () => {
    let seed = 7;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    let held = 0;
    let expected = 0;
    let n = 0;
    for (let s = 0; s < 8; s++) {
      let p = 100;
      const walk = Array.from({ length: 1000 }, (_, i) => {
        const open = p;
        p *= Math.exp((rnd() - 0.5) * 0.05);
        return { ...bar(i, p), open, high: Math.max(open, p) * (1 + rnd() * 0.01), low: Math.min(open, p) * (1 - rnd() * 0.01) };
      });
      for (const t of trackLevels(walk)) {
        if (t.outcome === "open" || t.expectedHeld === null) continue;
        n++;
        held += t.outcome === "held" ? 1 : 0;
        expected += t.expectedHeld;
      }
    }
    expect(n).toBeGreaterThan(300);
    // the naive yardstick (a level at the day's close) would be ~4 points too low here; the matched one is within noise
    expect(Math.abs(held / n - expected / n)).toBeLessThan(0.03);
  });

  it("is absent while a test is still open", () => {
    expect(testOn(after([L * 1.01, L]), 260).expectedHeld).toBeNull();
  });
});
