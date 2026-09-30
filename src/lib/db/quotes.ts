import type { Quote } from "@/lib/stock/types";
import { sql } from "./client";

export interface CachedQuote {
  symbol: string;
  price: number;
  quoteTime: Date;
  fetchedAt: Date;
}

export async function listCachedQuotes(symbols: string[]): Promise<CachedQuote[]> {
  if (symbols.length === 0) return [];
  return sql()<CachedQuote[]>`
    select symbol, price::float8 as price, quote_time as "quoteTime", fetched_at as "fetchedAt"
    from quotes where symbol in ${sql()(symbols)}`;
}

export async function upsertQuotes(quotes: Quote[]) {
  for (const q of quotes) {
    await sql()`
      insert into quotes (symbol, price, prev_close, quote_time, fetched_at)
      values (${q.symbol}, ${q.price}, ${q.previousClose}, ${q.quoteTime}, now())
      on conflict (symbol) do update
        set price = excluded.price, prev_close = excluded.prev_close,
            quote_time = excluded.quote_time, fetched_at = excluded.fetched_at`;
  }
}
