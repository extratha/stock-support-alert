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

/** A price band where the price turned up more than once: several swing lows within `width` of each other. */
export interface SwingZone {
  /** lowest swing low in the band (a close well below it = the zone broke) */
  low: number;
  /** highest swing low in the band (where buyers showed up first) */
  high: number;
  /** how many separate swing lows (bounces) fall in the band */
  touches: number;
  /** date of the most recent bounce */
  lastDate: string;
}

export interface ZoneOptions extends SwingOptions {
  /** Swing lows closer than this fraction are the same zone. */
  width: number;
}

const DEFAULT_ZONES: ZoneOptions = { wing: 5, lookback: 250, width: 0.015 };

/**
 * Groups the swing lows of the last `lookback` bars into zones. A lone swing low is a zone with one touch;
 * one the price bounced from three times is a much stronger level, which is what `touches` tells apart.
 * Returned highest first.
 */
export function swingZones(candles: Candle[], { width, ...swing }: ZoneOptions = DEFAULT_ZONES): SwingZone[] {
  const lows = findSwingLows(candles, swing).sort((a, b) => a.low - b.low);
  const zones: SwingZone[] = [];
  for (const c of lows) {
    const z = zones.at(-1);
    if (z && c.low <= z.low * (1 + width)) {
      z.high = c.low;
      z.touches++;
      if (c.date > z.lastDate) z.lastDate = c.date;
    } else {
      zones.push({ low: c.low, high: c.low, touches: 1, lastDate: c.date });
    }
  }
  return zones.reverse();
}
