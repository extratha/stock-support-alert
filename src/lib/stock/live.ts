/**
 * Live prices for DISPLAY ONLY (the dashboard). Completely separate from the Twelve Data
 * provider that feeds support levels and LINE alerts, so it neither uses Twelve Data credits
 * nor changes what alerts are based on.
 *
 * Per symbol: Finnhub first (official, free key: FINNHUB_API_KEY), then Yahoo's unofficial
 * chart endpoint as a best-effort fallback (keyless, but often blocked from datacenter IPs).
 */
export type LiveSource = "finnhub" | "yahoo";

export interface LivePrice {
  symbol: string;
  price: number;
  previousClose: number | null;
  /** ISO time of the last trade, when the source says. */
  asOf: string | null;
  source: LiveSource;
}

/** What /api/prices returns per symbol. `db` = the price stored by the scheduled Twelve Data check. */
export interface PriceEntry {
  price: number;
  /** ISO time of the price (last trade, or when the cron check stored it). */
  asOf: string | null;
  source: LiveSource | "db";
}

type Json = Record<string, unknown>;
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const iso = (epochSeconds: number | null) => (epochSeconds && epochSeconds > 0 ? new Date(epochSeconds * 1000).toISOString() : null);

/** Finnhub /quote: c = current, pc = previous close, t = last trade (unix s). Unknown symbols come back as zeros. */
export function parseFinnhubQuote(symbol: string, json: Json): LivePrice | null {
  const price = num(json.c);
  if (price === null || price <= 0) return null;
  const pc = num(json.pc);
  return { symbol, price, previousClose: pc && pc > 0 ? pc : null, asOf: iso(num(json.t)), source: "finnhub" };
}

/** Yahoo v8 chart: chart.result[0].meta.{regularMarketPrice, chartPreviousClose, regularMarketTime}. */
export function parseYahooChart(symbol: string, json: Json): LivePrice | null {
  const result = ((json.chart as Json | undefined)?.result as Json[] | null | undefined)?.[0];
  const meta = result?.meta as Json | undefined;
  const price = num(meta?.regularMarketPrice);
  if (price === null || price <= 0) return null;
  return {
    symbol,
    price,
    previousClose: num(meta?.chartPreviousClose),
    asOf: iso(num(meta?.regularMarketTime)),
    source: "yahoo",
  };
}

const TIMEOUT_MS = 5000;

async function getJson(url: string, headers: Record<string, string> = {}): Promise<Json> {
  const res = await fetch(url, { headers, cache: "no-store", signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as Json;
}

async function fromFinnhub(symbol: string, key: string): Promise<LivePrice> {
  // The key goes in a header so it never appears in a logged URL.
  const json = await getJson(`https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}`, { "X-Finnhub-Token": key });
  const parsed = parseFinnhubQuote(symbol, json);
  if (!parsed) throw new Error("no quote");
  return parsed;
}

async function fromYahoo(symbol: string): Promise<LivePrice> {
  const json = await getJson(
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1d`,
    { "User-Agent": "Mozilla/5.0 (compatible; stock-support-alert)" },
  );
  const parsed = parseYahooChart(symbol, json);
  if (!parsed) throw new Error("no quote");
  return parsed;
}

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** One symbol: Finnhub, then Yahoo. Never throws; the error lists what each source said. */
export async function fetchLivePrice(symbol: string): Promise<{ price?: LivePrice; error?: string }> {
  const failures: string[] = [];
  const key = process.env.FINNHUB_API_KEY;
  if (key) {
    try {
      return { price: await fromFinnhub(symbol, key) };
    } catch (err) {
      failures.push(`finnhub: ${message(err)}`);
    }
  } else {
    failures.push("finnhub: no FINNHUB_API_KEY");
  }
  try {
    return { price: await fromYahoo(symbol) };
  } catch (err) {
    failures.push(`yahoo: ${message(err)}`);
  }
  return { error: failures.join("; ") };
}

/** Short cache so several open tabs / quick refreshes don't hammer the free APIs. */
export const LIVE_CACHE_TTL_MS = 30_000;
const cache = new Map<string, { at: number; price: LivePrice }>();
export const clearLiveCache = () => cache.clear();

const CONCURRENCY = 5;

export async function fetchLivePrices(
  symbols: string[],
  now: number = Date.now(),
): Promise<{ prices: Record<string, LivePrice>; errors: Record<string, string> }> {
  const prices: Record<string, LivePrice> = {};
  const errors: Record<string, string> = {};
  const todo: string[] = [];

  for (const symbol of symbols) {
    const hit = cache.get(symbol);
    if (hit && now - hit.at < LIVE_CACHE_TTL_MS) prices[symbol] = hit.price;
    else todo.push(symbol);
  }

  let next = 0;
  const worker = async () => {
    while (next < todo.length) {
      const symbol = todo[next++];
      const { price, error } = await fetchLivePrice(symbol);
      if (price) {
        prices[symbol] = price;
        cache.set(symbol, { at: now, price });
      } else {
        errors[symbol] = error ?? "unknown error";
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, todo.length) }, worker));
  return { prices, errors };
}
