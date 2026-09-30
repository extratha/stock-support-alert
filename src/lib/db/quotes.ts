import type { Quote } from "@/lib/stock/types";
import { sql } from "./client";

export interface CachedQuote {
  symbol: string;
  price: number;
  dayLow: number | null;
  quoteTime: Date;
  fetchedAt: Date;
}

export async function listCachedQuotes(symbols: string[]): Promise<CachedQuote[]> {
  if (symbols.length === 0) return [];
  return sql()<CachedQuote[]>`
    select symbol, price::float8 as price, day_low::float8 as "dayLow", quote_time as "quoteTime", fetched_at as "fetchedAt"
    from quotes where symbol in ${sql()(symbols)}`;
}

export async function upsertQuotes(quotes: Quote[]) {
  for (const q of quotes) {
    await sql()`
      insert into quotes (symbol, price, prev_close, day_low, quote_time, fetched_at)
      values (${q.symbol}, ${q.price}, ${q.previousClose}, ${q.dayLow}, ${q.quoteTime}, now())
      on conflict (symbol) do update
        set price = excluded.price, prev_close = excluded.prev_close, day_low = excluded.day_low,
            quote_time = excluded.quote_time, fetched_at = excluded.fetched_at`;
  }
}
