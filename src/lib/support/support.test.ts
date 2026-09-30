import { describe, expect, it } from "vitest";
import { computeSupports } from "./calculate";
import { fibonacciRetracement } from "./fibonacci";
import { sma } from "./movingAverage";
import { classicPivot } from "./pivot";
import { findSwingLows } from "./swing";
import type { Candle } from "./types";

const bar = (i: number, close: number, spread = 1): Candle => ({
  date: new Date(Date.UTC(2025, 0, 1 + i)).toISOString().slice(0, 10),
  open: close,
  high: close + spread,
  low: close - spread,
  close,
  volume: 1000,
});

describe("classicPivot", () => {
  it("matches the textbook formulas", () => {
    // H=110 L=90 C=100 -> P=100, S1=90, S2=80, S3=90-2*(110-100)=70
    expect(classicPivot({ high: 110, low: 90, close: 100 })).toEqual({ pivot: 100, s1: 90, s2: 80, s3: 70 });
  });
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

  it("rejects too little history", () => {
    expect(() => computeSupports([bar(0, 10), bar(1, 11)])).toThrow(/at least/);
  });
});
