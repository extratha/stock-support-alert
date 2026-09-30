import type { Candle } from "./types";

export interface ClassicPivot {
  pivot: number;
  s1: number;
  s2: number;
  s3: number;
}

/**
 * Classic (floor-trader) pivot points from one completed session.
 *   P  = (H + L + C) / 3
 *   S1 = 2P - H
 *   S2 = P - (H - L)
 *   S3 = L - 2 (H - P)
 */
export function classicPivot({ high, low, close }: Pick<Candle, "high" | "low" | "close">): ClassicPivot {
  const pivot = (high + low + close) / 3;
  return {
    pivot,
    s1: 2 * pivot - high,
    s2: pivot - (high - low),
    s3: low - 2 * (high - pivot),
  };
}
