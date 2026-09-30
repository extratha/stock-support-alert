import { NextResponse } from "next/server";
import { listCachedQuotes } from "@/lib/db/quotes";
import { listSymbols } from "@/lib/db/symbols";
import { fetchLivePrices, type PriceEntry } from "@/lib/stock/live";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Current prices for the dashboard (behind the login via proxy.ts). Display only: nothing here
 * is stored or used for alerts. Only tracked symbols are queried (never user-supplied ones).
 * A symbol the live sources can't give falls back to the price saved by the cron check.
 */
export async function GET() {
  const symbols = await listSymbols();
  const [live, cached] = await Promise.all([fetchLivePrices(symbols), listCachedQuotes(symbols).catch(() => [])]);

  const prices: Record<string, PriceEntry> = {};
  for (const symbol of symbols) {
    const fresh = live.prices[symbol];
    const saved = cached.find((q) => q.symbol === symbol);
    if (fresh) prices[symbol] = { price: fresh.price, asOf: fresh.asOf, source: fresh.source };
    else if (saved) prices[symbol] = { price: saved.price, asOf: saved.quoteTime.toISOString(), source: "db" };
  }
  return NextResponse.json({ prices, errors: live.errors });
}
