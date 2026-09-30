import { config } from "@/lib/config";
import { listCachedQuotes, upsertQuotes } from "@/lib/db/quotes";
import { stockProvider } from "@/lib/stock";

export interface QuoteLookup {
  prices: Record<string, number>;
  /** Today's low per symbol (only where the provider supplied it). */
  lows: Record<string, number>;
  errors: Record<string, string>;
  fetched: number;
  cached: number;
}

/**
 * Cache-first quote lookup: only symbols whose cached quote is older than the
 * TTL hit the API, in a single batched request.
 */
export async function getQuotes(symbols: string[], now: Date): Promise<QuoteLookup> {
  const ttlMs = config.quoteCacheTtlMinutes() * 60_000;
  const cachedRows = await listCachedQuotes(symbols);

  const prices: Record<string, number> = {};
  const lows: Record<string, number> = {};
  const fresh = new Set<string>();
  for (const q of cachedRows) {
    if (now.getTime() - q.fetchedAt.getTime() < ttlMs) {
      prices[q.symbol] = q.price;
      if (q.dayLow !== null) lows[q.symbol] = q.dayLow;
      fresh.add(q.symbol);
    }
  }

  const stale = symbols.filter((s) => !fresh.has(s));
  const errors: Record<string, string> = {};
  if (stale.length > 0) {
    const result = await stockProvider.getQuotes(stale);
    await upsertQuotes(Object.values(result.data));
    for (const q of Object.values(result.data)) {
      prices[q.symbol] = q.price;
      if (q.dayLow !== null) lows[q.symbol] = q.dayLow;
    }
    Object.assign(errors, result.errors);
  }

  return { prices, lows, errors, fetched: stale.length, cached: fresh.size };
}
