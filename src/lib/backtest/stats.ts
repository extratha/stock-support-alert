import { HORIZONS, type Horizon, type Outcome } from "./engine";

export const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
export const median = (xs: number[]) => {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const quantile = (xs: number[], q: number) => {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.floor(q * (s.length - 1))))];
};

/** Small deterministic PRNG so a report can be reproduced exactly. */
export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 90% bootstrap interval for the mean (events resampled independently; real uncertainty is larger because events cluster in time). */
export function bootstrapMeanCI(xs: number[], reps = 2000, seed = 42): { mean: number; lo: number; hi: number } {
  if (xs.length === 0) return { mean: NaN, lo: NaN, hi: NaN };
  const rand = mulberry32(seed);
  const means: number[] = [];
  for (let r = 0; r < reps; r++) {
    let sum = 0;
    for (let i = 0; i < xs.length; i++) sum += xs[(rand() * xs.length) | 0];
    means.push(sum / xs.length);
  }
  return { mean: mean(xs), lo: quantile(means, 0.05), hi: quantile(means, 0.95) };
}

export type Row = { symbol: string; date?: string; bucket?: number } & Outcome;

/** What random entry days of the same stock gave, per symbol. */
export interface SymbolBaseline {
  ret: Record<Horizon, number>; // mean return
  pos20: number; // share of days with a positive 20-day return
  mae20: number; // mean worst adverse move within 20 days
  fell3: number; // share of days followed by a close >= 3% below entry within 20 days
}

/** What to compare an event with: the random days it is "matched" to (same stock, optionally same month). */
export type BaselineKey = (row: Row) => string;
const bySymbol: BaselineKey = (r) => r.symbol;
/** Same stock, same calendar month: removes the effect of the market regime (bear/bull) from the comparison. */
export const bySymbolMonth: BaselineKey = (r) => `${r.symbol}|${(r.date ?? "").slice(0, 7)}`;

/**
 * Same stock, similar recent drop: each stock's days are split into 5 equal groups by their prior-5-day return
 * (bucket 0 = had fallen the most). Comparing an event only with days in the same group answers "does the support
 * level add anything beyond the fact that the price had just dropped?" (stocks that just fell tend to bounce anyway).
 */
export const bySymbolBucket: BaselineKey = (r) => `${r.symbol}|${r.bucket ?? -1}`;

/** Same stock, same calendar year (market regime removed; no control for the recent drop). */
export const bySymbolYear: BaselineKey = (r) => `${r.symbol}|${(r.date ?? "").slice(0, 4)}`;

/**
 * Strictest match: same stock, same calendar YEAR, similar recent drop. Removes the market regime (bear 2022 vs
 * bull 2023-25) and the "it had just fallen" effect at the same time, so what is left is the support level itself.
 */
export const bySymbolYearBucket: BaselineKey = (r) => `${r.symbol}|${(r.date ?? "").slice(0, 4)}|${r.bucket ?? -1}`;

const BUCKETS = 5;

/** Builds the bucket function from the baseline days: per-stock quintile edges of prev5. */
export function makeBucketer(samples: { symbol: string; prev5: number | null }[]): (symbol: string, prev5: number | null) => number {
  const edges = new Map<string, number[]>();
  for (const symbol of new Set(samples.map((s) => s.symbol))) {
    const vals = samples.filter((s) => s.symbol === symbol && s.prev5 !== null).map((s) => s.prev5!);
    edges.set(symbol, Array.from({ length: BUCKETS - 1 }, (_, i) => quantile(vals, (i + 1) / BUCKETS)));
  }
  return (symbol, prev5) => {
    const e = edges.get(symbol);
    if (!e || prev5 === null) return -1;
    let b = 0;
    while (b < e.length && prev5 > e[b]) b++;
    return b;
  };
}

export function baselineBySymbol(samples: Row[], keyOf: BaselineKey = bySymbol): Record<string, SymbolBaseline> {
  const out: Record<string, SymbolBaseline> = {};
  const groups = new Map<string, Row[]>();
  for (const s of samples) {
    const k = keyOf(s);
    (groups.get(k) ?? groups.set(k, []).get(k)!).push(s);
  }
  for (const [symbol, mine] of groups) {
    const ret = {} as Record<Horizon, number>;
    for (const h of HORIZONS) ret[h] = mean(mine.map((s) => s.ret[h]).filter((v): v is number => v !== null));
    const with20 = mine.filter((s) => s.ret[20] !== null);
    const withDd = mine.filter((s) => s.mae20 !== null);
    out[symbol] = {
      ret,
      pos20: mean(with20.map((s) => (s.ret[20]! > 0 ? 1 : 0))),
      mae20: mean(withDd.map((s) => s.mae20!)),
      fell3: mean(withDd.map((s) => (s.fell3 ? 1 : 0))),
    };
  }
  return out;
}

export interface GroupSummary {
  n: number;
  /** mean / median return after 5 / 20 / 60 days, and how many events had that much data */
  ret: Record<Horizon, { n: number; mean: number; median: number }>;
  pos20: number;
  p10_20: number; // 10th percentile of 20-day returns (the bad-case tail)
  mae20: number;
  fell3: number;
  /** actual minus what the matched random days gave (same mix of stocks/months as the events) */
  excess: {
    ret5: number;
    ret20: { mean: number; lo: number; hi: number }; // with 90% bootstrap interval
    ret60: number;
    pos20: number;
    mae20: number;
    fell3: number;
  };
}

const finite = (xs: number[]) => xs.filter((x) => Number.isFinite(x));

/**
 * Summarise a group of events against the matched baseline. `keyOf` decides what "matched" means: the same stock
 * over the whole period (bySymbol) or the same stock in the same month (bySymbolMonth, removes the market regime).
 * Events with no matching baseline (e.g. too little data that month) still count in the raw numbers but not in "excess".
 */
export function summarize(rows: Row[], baseline: Record<string, SymbolBaseline>, keyOf: BaselineKey = bySymbol): GroupSummary {
  const baseOf = (r: Row): SymbolBaseline | undefined => baseline[keyOf(r)];

  const ret = {} as GroupSummary["ret"];
  for (const h of HORIZONS) {
    const vals = rows.map((r) => r.ret[h]).filter((v): v is number => v !== null);
    ret[h] = { n: vals.length, mean: mean(vals), median: median(vals) };
  }
  const r20 = rows.filter((r) => r.ret[20] !== null);
  const rDd = rows.filter((r) => r.mae20 !== null);
  const pos20 = mean(r20.map((r) => (r.ret[20]! > 0 ? 1 : 0)));
  const mae20 = mean(rDd.map((r) => r.mae20!));
  const fell3 = mean(rDd.map((r) => (r.fell3 ? 1 : 0)));

  const excessRet = (h: Horizon) =>
    finite(rows.filter((r) => r.ret[h] !== null && baseOf(r)).map((r) => r.ret[h]! - baseOf(r)!.ret[h]));
  /** actual share/mean over the events that have a baseline, minus the baseline's own value for the same events */
  const excessRate = (pick: (r: Row) => number | null, baseValue: (b: SymbolBaseline) => number) => {
    const usable = rows.filter((r) => pick(r) !== null && baseOf(r) && Number.isFinite(baseValue(baseOf(r)!)));
    return mean(usable.map((r) => pick(r)!)) - mean(usable.map((r) => baseValue(baseOf(r)!)));
  };

  return {
    n: rows.length,
    ret,
    pos20,
    p10_20: quantile(r20.map((r) => r.ret[20]!), 0.1),
    mae20,
    fell3,
    excess: {
      ret5: mean(excessRet(5)),
      ret20: bootstrapMeanCI(excessRet(20)),
      ret60: mean(excessRet(60)),
      pos20: excessRate((r) => (r.ret[20] === null ? null : r.ret[20] > 0 ? 1 : 0), (b) => b.pos20),
      mae20: excessRate((r) => r.mae20, (b) => b.mae20),
      fell3: excessRate((r) => (r.fell3 === null ? null : r.fell3 ? 1 : 0), (b) => b.fell3),
    },
  };
}
