import type { Candle } from "@/lib/support/types";

export interface Quote {
  symbol: string;
  price: number;
  previousClose: number | null;
  /** Time of the last trade as reported by the provider. */
  quoteTime: Date;
}

/** Per-symbol results; a failed symbol lands in `errors` instead of failing the whole batch. */
export interface BatchResult<T> {
  data: Record<string, T>;
  errors: Record<string, string>;
}

/** Swap providers by implementing this; nothing else in the app knows about the vendor. */
export interface StockDataProvider {
  /** Daily OHLC history, oldest -> newest. May include the still-forming current-day bar. */
  getDailyCandles(symbols: string[], bars: number): Promise<BatchResult<Candle[]>>;
  getQuotes(symbols: string[]): Promise<BatchResult<Quote>>;
}
