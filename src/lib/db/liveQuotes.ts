import type { LivePrice } from "@/lib/stock/live";
import { sql } from "./client";

export interface StoredLivePrice extends LivePrice {
  /** When we fetched it from the provider (not when the trade happened). */
  fetchedAt: Date;
}

export async function listLiveQuotes(symbols: string[]): Promise<StoredLivePrice[]> {
  if (symbols.length === 0) return [];
  const rows = await sql()<
    { symbol: string; price: number; previousClose: number | null; asOf: Date | null; source: LivePrice["source"]; fetchedAt: Date }[]
  >`
    select symbol, price::float8 as price, previous_close::float8 as "previousClose",
           as_of as "asOf", source, fetched_at as "fetchedAt"
    from live_quotes where symbol in ${sql()(symbols)}`;
  return rows.map((r) => ({ ...r, asOf: r.asOf ? r.asOf.toISOString() : null }));
}

export async function upsertLiveQuotes(prices: LivePrice[]) {
  for (const p of prices) {
    await sql()`
      insert into live_quotes (symbol, price, previous_close, as_of, source, fetched_at)
      values (${p.symbol}, ${p.price}, ${p.previousClose}, ${p.asOf}, ${p.source}, now())
      on conflict (symbol) do update
        set price = excluded.price, previous_close = excluded.previous_close, as_of = excluded.as_of,
            source = excluded.source, fetched_at = excluded.fetched_at`;
  }
}
