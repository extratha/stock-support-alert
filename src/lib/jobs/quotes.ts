import { config } from "@/lib/config";
import { listCachedQuotes, upsertQuotes } from "@/lib/db/quotes";
import { stockProvider } from "@/lib/stock";

export interface QuoteLookup {
  prices: Record<string, number>;
  /** Today's low per symbol (only where the provider supplied it). */
  lows: Record<string, number>;
  /** the provider's previous close, to catch a split before comparing with stored levels */
  prevCloses: Record<string, number>;
  errors: Record<string, string>;
  fetched: number;
  cached: number;
  /** Stale symbols not fetched this call because of the per-minute API limit. */
  remaining: number;
}

/**
 * Cache-first quote lookup: only symbols whose cached quote is older than the
 * TTL hit the API, in a single request of at most `apiCreditsPerMinute` symbols.
 * The rest are reported in `remaining`/`errors` so the caller can come back after a pause.
 */
export async function getQuotes(symbols: string[], now: Date): Promise<QuoteLookup> {
  const ttlMs = config.quoteCacheTtlMinutes() * 60_000;
  const cachedRows = await listCachedQuotes(symbols);

  const prices: Record<string, number> = {};
  const lows: Record<string, number> = {};
  const prevCloses: Record<string, number> = {};
  const fresh = new Set<string>();
  for (const q of cachedRows) {
    if (now.getTime() - q.fetchedAt.getTime() < ttlMs) {
      prices[q.symbol] = q.price;
      if (q.dayLow !== null) lows[q.symbol] = q.dayLow;
      if (q.prevClose !== null) prevCloses[q.symbol] = q.prevClose;
      fresh.add(q.symbol);
    }
  }

  const allStale = symbols.filter((s) => !fresh.has(s));
  const stale = allStale.slice(0, config.apiCreditsPerMinute());
  const deferred = allStale.slice(stale.length);
  const errors: Record<string, string> = {};
  for (const s of deferred) errors[s] = "deferred: per-minute API limit";
  if (stale.length > 0) {
    const result = await stockProvider.getQuotes(stale);
    await upsertQuotes(Object.values(result.data));
    for (const q of Object.values(result.data)) {
      prices[q.symbol] = q.price;
      if (q.dayLow !== null) lows[q.symbol] = q.dayLow;
      if (q.previousClose !== null) prevCloses[q.symbol] = q.previousClose;
    }
    Object.assign(errors, result.errors);
  }

  return { prices, lows, prevCloses, errors, fetched: stale.length, cached: fresh.size, remaining: deferred.length };
}
