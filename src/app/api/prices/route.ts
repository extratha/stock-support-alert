import { NextResponse } from "next/server";
import { listCachedQuotes } from "@/lib/db/quotes";
import { listSymbols } from "@/lib/db/symbols";
import { getLivePrices } from "@/lib/jobs/livePrices";
import { PAGE_DATA_TIMEOUT_MS, withTimeout } from "@/lib/timeout";
import type { PriceEntry } from "@/lib/stock/live";

export const dynamic = "force-dynamic";
export const maxDuration = 20;

/**
 * Current prices for the dashboard (behind the login via proxy.ts). Display only: nothing here
 * feeds alerts. Only tracked symbols are queried (never user-supplied ones).
 *
 *   GET /api/prices           cached for LIVE_PRICE_TTL_SECONDS (shared by everyone, in the DB)
 *   GET /api/prices?force=1   the refresh button: skips that cache (rate-limited per symbol)
 *
 * Always answers within ~15 s: external sources share one deadline, and a symbol that none of
 * them could give falls back to the last cached live price, then to the price saved by the
 * scheduled Twelve Data check.
 */
export async function GET(request: Request) {
  const force = new URL(request.url).searchParams.get("force") === "1";
  try {
    const symbols = await withTimeout(listSymbols(), PAGE_DATA_TIMEOUT_MS, "list symbols");
    const [live, saved] = await Promise.all([
      getLivePrices(symbols, { force }),
      listCachedQuotes(symbols).catch(() => []),
    ]);

    const prices: Record<string, PriceEntry> = { ...live.prices };
    for (const symbol of symbols) {
      const q = saved.find((s) => s.symbol === symbol);
      if (!prices[symbol] && q) prices[symbol] = { price: q.price, asOf: q.quoteTime.toISOString(), source: "db" };
    }
    return NextResponse.json({ prices, errors: live.errors });
  } catch (err) {
    console.error("/api/prices failed", err);
    return NextResponse.json({ error: "could not load prices" }, { status: 503 });
  }
}
