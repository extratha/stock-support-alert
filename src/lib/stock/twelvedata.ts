import { requireEnv } from "@/lib/config";
import type { Candle } from "@/lib/support/types";
import type { BatchResult, Quote, StockDataProvider } from "./types";

const BASE_URL = "https://api.twelvedata.com";

type Json = Record<string, unknown>;

/**
 * Twelve Data returns a flat object for one symbol and `{ SYMBOL: {...} }` for
 * several. A top-level `status: "error"` means the whole request failed.
 */
export function splitBatch(json: Json, symbols: string[]): Record<string, Json> {
  if (json.status === "error" && typeof json.code === "number" && json.code !== 404) {
    throw new Error(`Twelve Data error ${json.code}: ${String(json.message)}`);
  }
  if (symbols.length === 1) return { [symbols[0]]: json };
  const out: Record<string, Json> = {};
  for (const s of symbols) out[s] = (json[s] as Json | undefined) ?? { status: "error", message: "missing in response" };
  return out;
}

export function parseTimeSeries(json: Json, symbols: string[]): BatchResult<Candle[]> {
  const result: BatchResult<Candle[]> = { data: {}, errors: {} };
  for (const [symbol, entry] of Object.entries(splitBatch(json, symbols))) {
    const values = entry.values as Json[] | undefined;
    if (entry.status === "error" || !Array.isArray(values)) {
      result.errors[symbol] = String(entry.message ?? "no data");
      continue;
    }
    const candles = values
      .map((v) => ({
        date: String(v.datetime).slice(0, 10),
        open: Number(v.open),
        high: Number(v.high),
        low: Number(v.low),
        close: Number(v.close),
        volume: Number(v.volume ?? 0),
      }))
      .filter((c) => [c.open, c.high, c.low, c.close].every(Number.isFinite))
      .sort((a, b) => a.date.localeCompare(b.date));
    result.data[symbol] = candles;
  }
  return result;
}

export function parseQuotes(json: Json, symbols: string[]): BatchResult<Quote> {
  const result: BatchResult<Quote> = { data: {}, errors: {} };
  for (const [symbol, entry] of Object.entries(splitBatch(json, symbols))) {
    const price = Number(entry.close);
    if (entry.status === "error" || !Number.isFinite(price)) {
      result.errors[symbol] = String(entry.message ?? "no quote");
      continue;
    }
    const prev = Number(entry.previous_close);
    const low = entry.low === undefined || entry.low === null || entry.low === "" ? NaN : Number(entry.low);
    const ts = Number(entry.timestamp);
    result.data[symbol] = {
      symbol,
      price,
      previousClose: Number.isFinite(prev) ? prev : null,
      dayLow: Number.isFinite(low) ? low : null,
      quoteTime: Number.isFinite(ts) && ts > 0 ? new Date(ts * 1000) : new Date(),
    };
  }
  return result;
}

async function call(path: string, params: Record<string, string>): Promise<Json> {
  const url = new URL(path, BASE_URL);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  // apikey goes in a header so it never ends up in logged URLs.
  const res = await fetch(url, {
    headers: { Authorization: `apikey ${requireEnv("STOCK_API_KEY")}` },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Twelve Data HTTP ${res.status}`);
  return (await res.json()) as Json;
}

export const twelveData: StockDataProvider = {
  async getDailyCandles(symbols, bars) {
    if (symbols.length === 0) return { data: {}, errors: {} };
    const json = await call("/time_series", {
      symbol: symbols.join(","),
      interval: "1day",
      outputsize: String(bars),
      order: "desc",
    });
    return parseTimeSeries(json, symbols);
  },

  async getQuotes(symbols) {
    if (symbols.length === 0) return { data: {}, errors: {} };
    const json = await call("/quote", { symbol: symbols.join(",") });
    return parseQuotes(json, symbols);
  },
};
