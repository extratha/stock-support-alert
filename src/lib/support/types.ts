/** One daily OHLC bar. `date` is the exchange-local trading date (YYYY-MM-DD). */
export interface Candle {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export const TIERS = ["minor", "intermediate", "major"] as const;
export type Tier = (typeof TIERS)[number];

export type Method =
  | "pivot_s1"
  | "pivot_s2"
  | "pivot_s3"
  | "ma50"
  | "ma200"
  | "swing_low"
  | "fib_382"
  | "fib_500"
  | "fib_618";

/** A raw support level produced by one technical method, before tiering. */
export interface SupportCandidate {
  method: Method;
  price: number;
}

/** A candidate that has been assigned to an importance tier. */
export interface TieredSupport extends SupportCandidate {
  tier: Tier;
}

export interface SupportResult {
  /** Date of the last completed candle used as input. */
  asOf: string;
  /** Close of that candle; candidates are only kept if below it. */
  refClose: number;
  /** Every candidate below refClose, highest first (useful for debugging). */
  candidates: SupportCandidate[];
  /** Up to three levels, ordered minor > intermediate > major by price. */
  tiers: TieredSupport[];
}

export const TIER_LABEL_TH: Record<Tier, string> = {
  minor: "แนวรับแรก",
  intermediate: "แนวรับถัดไป",
  major: "แนวรับสำคัญ",
};

export const METHOD_LABEL: Record<Method, string> = {
  pivot_s1: "Pivot S1",
  pivot_s2: "Pivot S2",
  pivot_s3: "Pivot S3",
  ma50: "MA50",
  ma200: "MA200",
  swing_low: "Swing Low",
  fib_382: "Fib 38.2%",
  fib_500: "Fib 50%",
  fib_618: "Fib 61.8%",
};
