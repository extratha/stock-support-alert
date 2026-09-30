import { describe, expect, it } from "vitest";
import { computeSupports } from "./calculate";
import { fibonacciRetracement } from "./fibonacci";
import { sma } from "./movingAverage";
import { findSwingLows, swingZones } from "./swing";
import type { Candle } from "./types";

const bar = (i: number, close: number, spread = 1): Candle => ({
  date: new Date(Date.UTC(2025, 0, 1 + i)).toISOString().slice(0, 10),
  open: close,
  high: close + spread,
  low: close - spread,
  close,
  volume: 1000,
});

describe("sma", () => {
  it("averages the last N closes and returns null without enough data", () => {
    const candles = [1, 2, 3, 4, 5].map((c, i) => bar(i, c));
    expect(sma(candles, 3)).toBe(4);
    expect(sma(candles, 6)).toBeNull();
  });
});

describe("findSwingLows", () => {
  it("finds a V-shaped low and ignores unconfirmed trailing bars", () => {
    const closes = [20, 19, 18, 17, 16, 15, 14, 15, 16, 17, 18, 19, 20, 13];
    const candles = closes.map((c, i) => bar(i, c, 0));
    const lows = findSwingLows(candles, { wing: 3, lookback: 100 });
    expect(lows.map((c) => c.low)).toEqual([14]); // the final 13 has no right-side confirmation
  });
});

/** V shapes: each value in `bottoms` is a low the price falls to (from 120) and then climbs back from. */
const vs = (bottoms: number[], depth = 8): Candle[] =>
  bottoms.flatMap((b) => [...Array.from({ length: depth }, (_, k) => b + (depth - k) * 2), b, ...Array.from({ length: depth }, (_, k) => b + (k + 1) * 2)]).map((c, i) => bar(i, c, 0));

describe("swingZones", () => {
  it("groups bounces at about the same price into one zone and counts them", () => {
    const zones = swingZones(vs([100, 130, 100.8, 99.5, 130]), { wing: 5, lookback: 500, width: 0.015 });
    const z = zones.find((x) => x.low === 99.5)!;
    expect(z).toMatchObject({ low: 99.5, high: 100.8, touches: 3 });
    expect(zones.map((x) => x.touches)).toEqual([2, 3]); // highest first: the two bounces at 130, then the 100 zone
  });
});

describe("fibonacciRetracement", () => {
  it("measures retracements down from the high of the latest up-leg", () => {
    const candles = [bar(0, 100, 0), bar(1, 150, 0), bar(2, 200, 0), bar(3, 180, 0)];
    const fib = fibonacciRetracement(candles, { lookback: 10, minRange: 0.1 })!;
    expect(fib.fib382).toBeCloseTo(200 - 0.382 * 100);
    expect(fib.fib500).toBeCloseTo(150);
    expect(fib.fib618).toBeCloseTo(200 - 0.618 * 100);
  });

  it("returns null in a pure downtrend (no up-leg)", () => {
    const candles = [200, 180, 160, 140].map((c, i) => bar(i, c, 0));
    expect(fibonacciRetracement(candles)).toBeNull();
  });
});

describe("computeSupports", () => {
  // 260-day steady uptrend with noise, so every method has data.
  const uptrend = Array.from({ length: 260 }, (_, i) => bar(i, 100 + i * 0.5 + Math.sin(i / 3) * 4, 2));

  it("returns three strictly descending tiers below the last close", () => {
    const r = computeSupports(uptrend);
    expect(r.tiers.map((t) => t.tier)).toEqual(["minor", "intermediate", "major"]);
    const prices = r.tiers.map((t) => t.price);
    expect(prices[0]).toBeLessThan(r.refClose);
    expect(prices[0]).toBeGreaterThan(prices[1]);
    expect(prices[1]).toBeGreaterThan(prices[2]);
  });

  it("prefers a long-term anchor (MA200 / Fib 61.8%) for the major tier", () => {
    const major = computeSupports(uptrend).tiers.find((t) => t.tier === "major")!;
    expect(["ma200", "fib_618"]).toContain(major.method);
  });

  it("never proposes a level above price (e.g. MA200 in a downtrend)", () => {
    const downtrend = Array.from({ length: 260 }, (_, i) => bar(i, 300 - i * 0.5, 1));
    const r = computeSupports(downtrend);
    expect(r.candidates.every((c) => c.price < r.refClose)).toBe(true);
    expect(r.tiers.some((t) => t.method === "ma200")).toBe(false);
  });

  it("uses structural levels only (no daily pivots) and keeps the tiers at least 1% apart", () => {
    const r = computeSupports(uptrend);
    expect(r.candidates.every((c) => !c.method.startsWith("pivot"))).toBe(true);
    for (let i = 1; i < r.tiers.length; i++) {
      const above = r.tiers[i - 1];
      expect(r.tiers[i].price).toBeLessThanOrEqual(Math.min(above.price, above.zoneLow ?? above.price) * 0.99);
    }
  });

  it("a swing zone the price bounced from several times becomes a level with its zone and bounce count", () => {
    // repeated bounces off ~100, then a rally to 150
    const candles = [...vs([100, 100.8, 99.5, 100.5]), ...Array.from({ length: 30 }, (_, i) => bar(1000 + i, 120 + i, 0))];
    const swing = computeSupports(candles).candidates.find((c) => c.method === "swing_low" && c.touches === 4)!;
    expect(swing).toMatchObject({ price: 100.8, zoneLow: 99.5 });
  });

  it("when the price is inside a zone, the level left to watch is the zone's bottom", () => {
    const candles = [...vs([100, 101]), bar(999, 100.5, 0)];
    const swing = computeSupports(candles).candidates.find((c) => c.method === "swing_low")!;
    expect(swing).toMatchObject({ price: 100, zoneLow: 100, touches: 2 });
  });

  it("rejects too little history", () => {
    expect(() => computeSupports([bar(0, 10), bar(1, 11)])).toThrow(/at least/);
  });
});
