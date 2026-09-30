import type { Candle } from "./types";

export interface FibLevels {
  high: number;
  low: number;
  fib382: number;
  fib500: number;
  fib618: number;
}

export interface FibOptions {
  /** Bars to scan for the swing high / low. */
  lookback: number;
  /** Ignore ranges smaller than this fraction of the low (avoids noise levels). */
  minRange: number;
}

export const DEFAULT_FIB: FibOptions = { lookback: 120, minRange: 0.1 };

/**
 * Fibonacci retracement of the most recent up-leg: the highest high in the
 * lookback window and the lowest low *before* it. Retracements are measured
 * down from the high: level = high - ratio * (high - low).
 * Returns null when there is no up-leg (high is at the start of the window).
 */
export function fibonacciRetracement(candles: Candle[], { lookback, minRange }: FibOptions = DEFAULT_FIB): FibLevels | null {
  const window = candles.slice(-lookback);
  if (window.length < 2) return null;

  let highIdx = 0;
  for (let i = 1; i < window.length; i++) if (window[i].high >= window[highIdx].high) highIdx = i;
  if (highIdx === 0) return null;

  let low = Infinity;
  for (let i = 0; i < highIdx; i++) low = Math.min(low, window[i].low);

  const high = window[highIdx].high;
  const range = high - low;
  if (!(range > 0) || range / low < minRange) return null;

  return {
    high,
    low,
    fib382: high - 0.382 * range,
    fib500: high - 0.5 * range,
    fib618: high - 0.618 * range,
  };
}
