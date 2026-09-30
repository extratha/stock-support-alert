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
  /** True when a newer price was being fetched but failed, so this older one is shown instead. */
  stale?: boolean;
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

/** One source gets this long before we move on to the next one. */
export const SOURCE_TIMEOUT_MS = 4000;

async function getJson(url: string, headers: Record<string, string>, deadline?: AbortSignal): Promise<Json> {
  // Whichever comes first: this source's own timeout, or the overall deadline of the whole request.
  const signal = deadline ? AbortSignal.any([AbortSignal.timeout(SOURCE_TIMEOUT_MS), deadline]) : AbortSignal.timeout(SOURCE_TIMEOUT_MS);
  const res = await fetch(url, { headers, cache: "no-store", signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as Json;
}

async function fromFinnhub(symbol: string, key: string, deadline?: AbortSignal): Promise<LivePrice> {
  // The key goes in a header so it never appears in a logged URL.
  const json = await getJson(
    `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}`,
    { "X-Finnhub-Token": key },
    deadline,
  );
  const parsed = parseFinnhubQuote(symbol, json);
  if (!parsed) throw new Error("no quote");
  return parsed;
}

async function fromYahoo(symbol: string, deadline?: AbortSignal): Promise<LivePrice> {
  const json = await getJson(
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1d`,
    { "User-Agent": "Mozilla/5.0 (compatible; stock-support-alert)" },
    deadline,
  );
  const parsed = parseYahooChart(symbol, json);
  if (!parsed) throw new Error("no quote");
  return parsed;
}

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

/**
 * One symbol: Finnhub, then Yahoo. Never throws; the error lists what each source said.
 * A source that is slow (SOURCE_TIMEOUT_MS) or fails is skipped in favour of the next one;
 * once `deadline` fires nothing further is attempted.
 */
export async function fetchLivePrice(symbol: string, deadline?: AbortSignal): Promise<{ price?: LivePrice; error?: string }> {
  const failures: string[] = [];
  const key = process.env.FINNHUB_API_KEY;
  if (key) {
    try {
      return { price: await fromFinnhub(symbol, key, deadline) };
    } catch (err) {
      failures.push(`finnhub: ${message(err)}`);
    }
  } else {
    failures.push("finnhub: no FINNHUB_API_KEY");
  }
  if (deadline?.aborted) {
    failures.push("yahoo: skipped, deadline reached");
  } else {
    try {
      return { price: await fromYahoo(symbol, deadline) };
    } catch (err) {
      failures.push(`yahoo: ${message(err)}`);
    }
  }
  return { error: failures.join("; ") };
}

const CONCURRENCY = 10; // Finnhub allows 30 calls/second; this keeps 20 symbols to ~2 rounds

/**
 * Fetch many symbols in parallel under ONE overall deadline (`deadlineMs`, all symbols and all
 * sources together). Symbols not finished in time are reported in `errors` so the caller can fall
 * back to stored prices; it always returns within roughly the deadline. No caching here: callers
 * decide (see jobs/livePrices.ts, which shares a cache through the database).
 */
export async function fetchLivePrices(
  symbols: string[],
  { deadlineMs = 12_000 }: { deadlineMs?: number } = {},
): Promise<{ prices: Record<string, LivePrice>; errors: Record<string, string> }> {
  const prices: Record<string, LivePrice> = {};
  const errors: Record<string, string> = {};
  const deadline = AbortSignal.timeout(deadlineMs);
  let next = 0;

  const worker = async () => {
    while (next < symbols.length) {
      const symbol = symbols[next++];
      if (deadline.aborted) {
        errors[symbol] = "deadline reached before this symbol was fetched";
        continue;
      }
      const { price, error } = await fetchLivePrice(symbol, deadline);
      if (price) prices[symbol] = price;
      else errors[symbol] = error ?? "unknown error";
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, symbols.length) }, worker));
  return { prices, errors };
}
