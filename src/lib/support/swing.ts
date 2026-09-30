import type { Candle } from "./types";

export interface SwingOptions {
  /** Bars on each side that must have a higher low (fractal width). */
  wing: number;
  /** Only consider swing lows within this many most-recent bars. */
  lookback: number;
}

const DEFAULT_SWING: SwingOptions = { wing: 5, lookback: 60 };

/**
 * Local minima ("swing lows"): a bar whose low is strictly lower than the lows
 * of `wing` bars on both sides. The last `wing` bars can never qualify because
 * the bounce has not been confirmed yet. Returned oldest -> newest.
 */
export function findSwingLows(candles: Candle[], { wing, lookback }: SwingOptions = DEFAULT_SWING): Candle[] {
  const start = Math.max(wing, candles.length - lookback);
  const end = candles.length - wing;
  const result: Candle[] = [];
  for (let i = start; i < end; i++) {
    const low = candles[i].low;
    let isSwing = true;
    for (let k = 1; k <= wing; k++) {
      if (candles[i - k].low <= low || candles[i + k].low <= low) {
        isSwing = false;
        break;
      }
    }
    if (isSwing) result.push(candles[i]);
  }
  return result;
}
