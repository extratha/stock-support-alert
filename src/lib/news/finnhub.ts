/** Free Finnhub endpoints for news: /company-news (per stock), /news?category=general (market), /stock/profile2 (name). */

export interface RawArticle {
  key: string;
  scope: "company" | "market";
  symbols: string[];
  source: string;
  headline: string;
  summary: string;
  url: string;
  publishedAt: Date;
}

type Json = Record<string, unknown>;

export class FinnhubHttpError extends Error {
  constructor(readonly status: number) {
    super(`Finnhub HTTP ${status}`);
  }
}

const TIMEOUT_MS = 8000;

async function get(path: string, key: string): Promise<unknown> {
  const res = await fetch(`https://finnhub.io/api/v1${path}`, {
    headers: { "X-Finnhub-Token": key },
    cache: "no-store",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new FinnhubHttpError(res.status);
  return res.json();
}

const text = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");

/**
 * Finnhub's news items, cleaned. Items without an id, headline, link or time are dropped, and so is anything older
 * than `since`. `symbol` = the tracked stock this list was asked for (null for market news).
 */
export function parseNews(json: unknown, scope: RawArticle["scope"], symbol: string | null, since: Date): RawArticle[] {
  const list = (Array.isArray(json) ? json : []) as Json[];
  const out: RawArticle[] = [];
  for (const item of list) {
    const id = typeof item.id === "number" || typeof item.id === "string" ? String(item.id) : "";
    const headline = text(item.headline, 300);
    const url = typeof item.url === "string" && /^https?:\/\//.test(item.url) ? item.url : "";
    const seconds = typeof item.datetime === "number" ? item.datetime : NaN;
    if (!id || !headline || !url || !Number.isFinite(seconds)) continue;
    const publishedAt = new Date(seconds * 1000);
    if (publishedAt < since) continue;
    out.push({
      key: `fh:${id}`,
      scope,
      symbols: symbol ? [symbol] : [],
      source: text(item.source, 60) || "?",
      headline,
      summary: text(item.summary, 1500),
      url,
      publishedAt,
    });
  }
  return out;
}

const ymd = (d: Date) => d.toISOString().slice(0, 10);

export async function fetchCompanyNews(symbol: string, since: Date, now: Date, key: string): Promise<RawArticle[]> {
  const json = await get(`/company-news?symbol=${encodeURIComponent(symbol)}&from=${ymd(since)}&to=${ymd(now)}`, key);
  return parseNews(json, "company", symbol, since);
}

export async function fetchMarketNews(since: Date, key: string): Promise<RawArticle[]> {
  return parseNews(await get(`/news?category=general`, key), "market", null, since);
}

/** "NVIDIA Corp" etc., or null when Finnhub has no profile for the symbol. */
export async function fetchCompanyName(symbol: string, key: string): Promise<string | null> {
  const json = (await get(`/stock/profile2?symbol=${encodeURIComponent(symbol)}`, key)) as Json;
  return text(json?.name, 120) || null;
}
