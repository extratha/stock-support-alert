import { config } from "@/lib/config";
import { listLiveQuotes, upsertLiveQuotes, type StoredLivePrice } from "@/lib/db/liveQuotes";
import { fetchLivePrices, type LivePrice, type PriceEntry } from "@/lib/stock/live";

export interface LivePricesResult {
  prices: Record<string, PriceEntry>;
  errors: Record<string, string>;
}

const toEntry = (p: LivePrice, stale = false): PriceEntry => ({
  price: p.price,
  asOf: p.asOf,
  source: p.source,
  ...(stale ? { stale: true } : {}),
});

// One fetch at a time per set of symbols inside this server instance: simultaneous requests
// (several tabs, prefetches, reload spam) share the same outbound calls.
const inflight = new Map<string, Promise<Awaited<ReturnType<typeof fetchLivePrices>>>>();

function fetchShared(symbols: string[], deadlineMs: number) {
  const key = [...symbols].sort().join(",");
  let pending = inflight.get(key);
  if (!pending) {
    pending = fetchLivePrices(symbols, { deadlineMs }).finally(() => inflight.delete(key));
    inflight.set(key, pending);
  }
  return pending;
}

/**
 * Live prices for the dashboard, with a cache shared by every server instance and every user (DB):
 *  - a price fetched within LIVE_PRICE_TTL_SECONDS (default 5 min) is reused, so however often the page
 *    is reloaded the free APIs see at most one call per symbol per TTL;
 *  - `force` (the refresh button) skips that cache but never refetches a symbol more often than
 *    LIVE_PRICE_MIN_REFRESH_SECONDS (default 30 s);
 *  - Finnhub -> Yahoo under one overall deadline (LIVE_PRICE_DEADLINE_MS, default 12 s);
 *  - a symbol that still fails keeps its last cached price (marked stale), if there is one.
 */
export async function getLivePrices(
  symbols: string[],
  { force = false, now = Date.now() }: { force?: boolean; now?: number } = {},
): Promise<LivePricesResult> {
  const prices: Record<string, PriceEntry> = {};
  const errors: Record<string, string> = {};

  const cached = new Map<string, StoredLivePrice>((await listLiveQuotes(symbols).catch(() => [])).map((q) => [q.symbol, q]));
  const maxAgeMs = (force ? config.livePriceMinRefreshSeconds() : config.livePriceTtlSeconds()) * 1000;

  const todo: string[] = [];
  for (const symbol of symbols) {
    const hit = cached.get(symbol);
    if (hit && now - hit.fetchedAt.getTime() < maxAgeMs) prices[symbol] = toEntry(hit);
    else todo.push(symbol);
  }
  if (todo.length === 0) return { prices, errors };

  const fetched = await fetchShared(todo, config.livePriceDeadlineMs());
  const fresh = Object.values(fetched.prices);
  if (fresh.length > 0) await upsertLiveQuotes(fresh).catch((e) => console.error("live price cache write failed", e));

  for (const symbol of todo) {
    const price = fetched.prices[symbol];
    const old = cached.get(symbol);
    if (price) prices[symbol] = toEntry(price);
    else {
      errors[symbol] = fetched.errors[symbol] ?? "unknown error";
      if (old) prices[symbol] = toEntry(old, true); // better an older real price than none
    }
  }
  return { prices, errors };
}
