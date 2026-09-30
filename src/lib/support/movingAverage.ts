import type { Candle } from "./types";

/** Simple moving average of the last `period` closes; null if not enough data. */
export function sma(candles: Candle[], period: number): number | null {
  if (candles.length < period) return null;
  let sum = 0;
  for (let i = candles.length - period; i < candles.length; i++) sum += candles[i].close;
  return sum / period;
}
