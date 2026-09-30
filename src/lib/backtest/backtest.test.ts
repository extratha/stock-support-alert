import { describe, expect, it } from "vitest";
import { computeSupports } from "@/lib/support/calculate";
import type { Candle } from "@/lib/support/types";
import { baselineSamples, findTouchEvents, outcomeFrom, SUPPORT_WINDOW, WARMUP_BARS } from "./engine";
import { baselineBySymbol, bootstrapMeanCI, bySymbolBucket, bySymbolMonth, bySymbolYearBucket, makeBucketer, mean, median, mulberry32, summarize, type Row } from "./stats";

/** Deterministic, mean-reverting random walk with realistic-ish highs/lows: plenty of dips to touch. */
function walk(n: number, seed: number): Candle[] {
  const rand = mulberry32(seed);
  const out: Candle[] = [];
  let price = 100;
  for (let i = 0; i < n; i++) {
    const drift = (100 + 15 * Math.sin(i / 40) - price) * 0.02; // pulls back toward a slowly moving centre
    const open = price;
    const close = Math.max(5, open * (1 + drift / 100 + (rand() - 0.5) * 0.035));
    const high = Math.max(open, close) * (1 + rand() * 0.012);
    const low = Math.min(open, close) * (1 - rand() * 0.012);
    const date = new Date(Date.UTC(2021, 0, 1 + i)).toISOString().slice(0, 10);
    out.push({ date, open, high, low, close, volume: 1000 });
    price = close;
  }
  return out;
}
const candles = walk(700, 7);
const indexOf = new Map(candles.map((c, i) => [c.date, i]));

describe("findTouchEvents", () => {
  const events = findTouchEvents("TEST", candles);

  it("produces events to analyse", () => {
    expect(events.length).toBeGreaterThan(5);
  });

  it("has no look-ahead: each event's level is exactly what the support logic gave from data up to the day BEFORE", () => {
    for (const e of events) {
      const d = indexOf.get(e.date)!;
      const { tiers } = computeSupports(candles.slice(Math.max(0, d - SUPPORT_WINDOW), d));
      const tier = tiers.find((t) => t.tier === e.tier);
      expect(tier?.price).toBe(e.level);
    }
  });

  it("only fires when the day's low reached the level (+0.3% tolerance), never before the warm-up", () => {
    for (const e of events) {
      const d = indexOf.get(e.date)!;
      expect(d).toBeGreaterThanOrEqual(WARMUP_BARS);
      expect(candles[d].low).toBeLessThanOrEqual(e.level * 1.003 + 1e-9);
    }
  });

  it("never fires twice for the same tier without a re-arm (close back above the level + 1%) in between", () => {
    for (const tier of ["minor", "intermediate", "major"] as const) {
      const mine = events.filter((e) => e.tier === tier);
      for (let i = 1; i < mine.length; i++) {
        const from = indexOf.get(mine[i - 1].date)!;
        const to = indexOf.get(mine[i].date)!;
        let rearmed = false;
        for (let d = from + 1; d < to && !rearmed; d++) {
          const t = computeSupports(candles.slice(Math.max(0, d - SUPPORT_WINDOW), d)).tiers.find((x) => x.tier === tier);
          if (t && candles[d].close > t.price * 1.01) rearmed = true;
        }
        expect(rearmed, `${tier}: ${mine[i - 1].date} -> ${mine[i].date}`).toBe(true);
      }
    }
  });

  it("limit-at-level entry is filled only if the low reached the level, at min(level, open)", () => {
    for (const e of events) {
      const d = indexOf.get(e.date)!;
      const filled = candles[d].low <= e.level;
      expect(e.atLevel !== null, `${e.date} ${e.tier}`).toBe(filled);
      if (filled) {
        const entry = Math.min(e.level, candles[d].open);
        if (d + 20 < candles.length) {
          const worst = Math.min(...candles.slice(d, d + 21).map((c) => c.low));
          expect(e.atLevel!.mae20).toBeCloseTo(worst / entry - 1, 10);
        }
      }
    }
  });
});

describe("outcomeFrom", () => {
  const base = (over: Partial<Candle>[]): Candle[] =>
    Array.from({ length: 70 }, (_, i) => ({ date: `d${i}`, open: 100, high: 101, low: 99, close: 100, volume: 1, ...over[i] }));

  it("measures returns at 5/20/60 days, the worst low and the >=3% close-drop flag", () => {
    const c = base([]);
    c[5] = { ...c[5], close: 110 };
    c[10] = { ...c[10], low: 88, close: 92 }; // dips 12% intraday, closes 8% below entry
    c[20] = { ...c[20], close: 90 };
    c[60] = { ...c[60], close: 120 };
    const o = outcomeFrom(c, 0, 100, false);
    expect(o.ret[5]).toBeCloseTo(0.1);
    expect(o.ret[20]).toBeCloseTo(-0.1);
    expect(o.ret[60]).toBeCloseTo(0.2);
    expect(o.mae20).toBeCloseTo(-0.12);
    expect(o.fell3).toBe(true);
  });

  it("records how far the stock had fallen over the 5 days before entry", () => {
    const c = base([]);
    c[10] = { ...c[10], close: 90 };
    c[5] = { ...c[5], close: 100 };
    expect(outcomeFrom(c, 10, 90, false).prev5).toBeCloseTo(-0.1);
    expect(outcomeFrom(c, 2, 100, false).prev5).toBeNull(); // not enough history yet
  });

  it("reports no drop flag when closes stay within 3%, and null where the data ends", () => {
    const c = base([]);
    const o = outcomeFrom(c, 0, 100, false);
    expect(o.fell3).toBe(false);
    const late = outcomeFrom(c, 60, 100, false);
    expect(late.ret[5]).not.toBeNull();
    expect(late.ret[20]).toBeNull();
    expect(late.mae20).toBeNull();
  });

  it("counts the entry day's own low only for limit entries", () => {
    const c = base([]);
    c[0] = { ...c[0], low: 90 };
    expect(outcomeFrom(c, 0, 100, false).mae20).toBeCloseTo(-0.01); // close entry: day 0 already happened
    expect(outcomeFrom(c, 0, 100, true).mae20).toBeCloseTo(-0.1); // limit entry: price kept falling after the fill
  });
});

describe("baselineSamples", () => {
  it("has one sample per eligible day", () => {
    expect(baselineSamples("TEST", candles)).toHaveLength(candles.length - WARMUP_BARS);
  });

  it("measures how far each day's close is below the highest high of the last 60 days (0 = at the peak)", () => {
    const samples = baselineSamples("TEST", candles);
    for (const s of samples.slice(0, 50)) {
      const d = indexOf.get(s.date)!;
      const high = Math.max(...candles.slice(Math.max(0, d - 60), d + 1).map((c) => c.high));
      expect(s.fromHigh60).toBeCloseTo(candles[d].close / high - 1, 12);
      expect(s.fromHigh60).toBeLessThanOrEqual(0);
    }
  });
});

describe("stats", () => {
  it("mean / median", () => {
    expect(mean([1, 2, 3, 4])).toBe(2.5);
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });
  it("bootstrap interval is reproducible and collapses for constant data", () => {
    const xs = Array.from({ length: 40 }, (_, i) => Math.sin(i));
    expect(bootstrapMeanCI(xs)).toEqual(bootstrapMeanCI(xs));
    const ci = bootstrapMeanCI(xs);
    expect(ci.lo).toBeLessThanOrEqual(ci.mean);
    expect(ci.hi).toBeGreaterThanOrEqual(ci.mean);
    const flat = bootstrapMeanCI([0.05, 0.05, 0.05]);
    expect(flat.mean).toBeCloseTo(0.05, 12);
    expect(flat.lo).toBeCloseTo(0.05, 12);
    expect(flat.hi).toBeCloseTo(0.05, 12);
  });
  it("excess = events minus what random days of the SAME stock gave", () => {
    const flat = { 5: 0, 20: 0, 60: 0 } as const;
    const mk = (symbol: string, r20: number): Row => ({ symbol, prev5: null, ret: { 5: null, 20: r20, 60: null }, mae20: -0.05, fell3: false });
    // baseline: stock A averages +10% per 20d, stock B averages 0%
    const bars = (symbol: string, r: number[]): Row[] => r.map((x) => mk(symbol, x));
    const base = baselineBySymbol([...bars("A", [0.1, 0.1]), ...bars("B", [0, 0])]);
    expect(base.A.ret[20]).toBeCloseTo(0.1);
    expect(base.B.ret[20]).toBeCloseTo(0);
    // events: A gave +12% (beat its own +10% by 2 pts), B gave -4% (lagged its own 0% by 4 pts)
    const s = summarize([mk("A", 0.12), mk("B", -0.04)], base);
    expect(s.n).toBe(2);
    expect(s.ret[20].mean).toBeCloseTo(0.04);
    expect(s.excess.ret20.mean).toBeCloseTo((0.02 + -0.04) / 2);
    expect(flat[20]).toBe(0);
  });

  it("month-matched baseline compares an event only with days of the same stock in the same month", () => {
    const mk = (date: string, r20: number): Row => ({ symbol: "A", date, prev5: null, ret: { 5: null, 20: r20, 60: null }, mae20: -0.05, fell3: false });
    // March was a great month for the stock (+10% on random days), April a terrible one (-10%)
    const base = baselineBySymbol([mk("2022-03-03", 0.1), mk("2022-03-10", 0.1), mk("2022-04-04", -0.1), mk("2022-04-11", -0.1)], bySymbolMonth);
    // an April event that returned -8% still beat the April average (-10%) by 2 points; a March event at +12% beat March (+10%) by 2
    const s = summarize([mk("2022-04-20", -0.08), mk("2022-03-25", 0.12)], base, bySymbolMonth);
    expect(s.excess.ret20.mean).toBeCloseTo(0.02);
    // whereas against the whole-period average (0%) the same events would look like -8% and +12%
    const whole = summarize([mk("2022-04-20", -0.08), mk("2022-03-25", 0.12)], baselineBySymbol([mk("2022-03-03", 0.1), mk("2022-04-04", -0.1)]));
    expect(whole.excess.ret20.mean).toBeCloseTo(0.02); // averages out here, but per-event excesses differ: -0.08 and +0.12
    expect(summarize([mk("2022-04-20", -0.08)], baselineBySymbol([mk("2022-03-03", 0.1), mk("2022-04-04", -0.1)])).excess.ret20.mean).toBeCloseTo(-0.08);
  });

  it("events in a month with no baseline data are kept in the raw numbers but excluded from the excess", () => {
    const mk = (date: string, r20: number): Row => ({ symbol: "A", date, prev5: null, ret: { 5: null, 20: r20, 60: null }, mae20: -0.05, fell3: false });
    const base = baselineBySymbol([mk("2022-03-03", 0.1)], bySymbolMonth);
    const s = summarize([mk("2022-03-20", 0.15), mk("2023-01-05", 0.5)], base, bySymbolMonth);
    expect(s.n).toBe(2);
    expect(s.ret[20].mean).toBeCloseTo(0.325);
    expect(s.excess.ret20.mean).toBeCloseTo(0.05); // only the March event is compared
  });

  it("buckets each stock's days by how hard it had just fallen (0 = fell the most), per stock", () => {
    const days = [
      ...[-0.1, -0.05, -0.02, 0, 0.02, 0.05, 0.08, 0.1, 0.12, 0.15].map((p) => ({ symbol: "A", prev5: p })),
      ...[-0.01, 0, 0.01, 0.02, 0.03].map((p) => ({ symbol: "B", prev5: p })),
    ];
    const bucketOf = makeBucketer(days);
    expect(bucketOf("A", -0.2)).toBe(0); // worse than any A day
    expect(bucketOf("A", 0.2)).toBe(4); // better than any A day
    expect(bucketOf("A", -0.05)).toBeLessThan(bucketOf("A", 0.1));
    expect(bucketOf("B", -0.01)).toBe(0); // B's own scale, not A's
    expect(bucketOf("A", null)).toBe(-1);
    expect(bucketOf("ZZ", 0.1)).toBe(-1);
  });

  it("dip-matched baseline compares an event only with days that had fallen about as much", () => {
    const mk = (prev5: number, bucket: number, r20: number): Row => ({ symbol: "A", bucket, prev5, ret: { 5: null, 20: r20, 60: null }, mae20: -0.05, fell3: false });
    // after a big fall (bucket 0) this stock bounces +8% on average; after a rally (bucket 4) only +1%
    const base = baselineBySymbol([mk(-0.1, 0, 0.08), mk(-0.1, 0, 0.08), mk(0.1, 4, 0.01), mk(0.1, 4, 0.01)], bySymbolBucket);
    const s = summarize([mk(-0.1, 0, 0.09)], base, bySymbolBucket);
    expect(s.excess.ret20.mean).toBeCloseTo(0.01); // +9% is only 1 point better than other post-fall days
    // against the all-days average (+4.5%) the same event would look like a 4.5-point win
    const naive = summarize([mk(-0.1, 0, 0.09)], baselineBySymbol([mk(-0.1, 0, 0.08), mk(0.1, 4, 0.01)]));
    expect(naive.excess.ret20.mean).toBeCloseTo(0.045);
  });

  it("year+dip matching keeps a bear year and a bull year apart even for equally 'dipped' days", () => {
    const mk = (date: string, bucket: number, r20: number): Row => ({ symbol: "A", date, bucket, prev5: null, ret: { 5: null, 20: r20, 60: null }, mae20: -0.05, fell3: false });
    // after a dip the stock gave -6% in the 2022 bear year but +6% in the 2023 bull year
    const base = baselineBySymbol([mk("2022-05-02", 0, -0.06), mk("2022-06-02", 0, -0.06), mk("2023-05-02", 0, 0.06), mk("2023-06-02", 0, 0.06)], bySymbolYearBucket);
    const s = summarize([mk("2022-08-01", 0, -0.05), mk("2023-08-01", 0, 0.07)], base, bySymbolYearBucket);
    expect(s.excess.ret20.mean).toBeCloseTo(0.01); // +1 point in each year: no regime effect left
    // matching on the dip only (ignoring the year) would credit/blame the regime: -5% vs 0% and +7% vs 0% average
    const dipOnly = summarize([mk("2022-08-01", 0, -0.05), mk("2023-08-01", 0, 0.07)], baselineBySymbol([mk("2022-05-02", 0, -0.06), mk("2022-06-02", 0, -0.06), mk("2023-05-02", 0, 0.06), mk("2023-06-02", 0, 0.06)], bySymbolBucket), bySymbolBucket);
    expect(dipOnly.excess.ret20.mean).toBeCloseTo(0.01); // same mean here, but per-year views would be +-5/7 points off
  });
});

