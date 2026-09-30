import type { Candle } from "@/lib/support/types";

/** ~52 weeks of trading days. */
const YEAR_BARS = 252;

export interface HistoryStats {
  lastClose: number;
  /** highest high of the last 52 weeks */
  high52w: number;
  /** worst fall from a previous peak close to a later close, over the whole history (negative, e.g. -0.66) */
  maxDrawdown: number;
  peakDate: string;
  troughDate: string;
  /** did a later close get back above that peak? */
  recovered: boolean;
  historyFrom: string;
}

/** Candles oldest -> newest (completed sessions only). */
export function historyStats(candles: Candle[]): HistoryStats | null {
  if (candles.length < 2) return null;
  const last = candles[candles.length - 1];

  let high52w = -Infinity;
  for (let i = Math.max(0, candles.length - YEAR_BARS); i < candles.length; i++) high52w = Math.max(high52w, candles[i].high);

  let peakIdx = 0;
  let worst = 0;
  let worstPeak = 0;
  let worstTrough = 0;
  for (let i = 1; i < candles.length; i++) {
    if (candles[i].close > candles[peakIdx].close) peakIdx = i;
    const dd = candles[i].close / candles[peakIdx].close - 1;
    if (dd < worst) {
      worst = dd;
      worstPeak = peakIdx;
      worstTrough = i;
    }
  }
  let recovered = false;
  for (let i = worstTrough + 1; i < candles.length && !recovered; i++) if (candles[i].close >= candles[worstPeak].close) recovered = true;

  return {
    lastClose: last.close,
    high52w,
    maxDrawdown: worst,
    peakDate: candles[worstPeak].date,
    troughDate: candles[worstTrough].date,
    recovered,
    historyFrom: candles[0].date,
  };
}
