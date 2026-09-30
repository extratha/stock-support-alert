import { NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/auth";
import { listSymbols } from "@/lib/db/symbols";
import { skipReason } from "@/lib/jobs/checkAlerts";
import { getQuotes } from "@/lib/jobs/quotes";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Warms the quote cache for the check run. Fetches at most API_CREDITS_PER_MINUTE stale
 * symbols per call and reports `remaining`; the workflow pauses ~1 minute and calls again
 * until it is 0, then calls /api/cron/check, which is then served entirely from cache.
 * Same `mode` / `force` semantics (time gate) as /api/cron/check.
 */
export async function POST(request: Request) {
  if (!isCronAuthorized(request)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const params = new URL(request.url).searchParams;
  const now = new Date();

  const skipped = await skipReason(now, {
    force: params.get("force") === "1",
    mode: params.get("mode") === "daily" ? "daily" : "intraday",
  });
  if (skipped) return NextResponse.json({ skipped, remaining: 0 });

  try {
    const symbols = await listSymbols();
    const { fetched, cached, remaining, errors } = await getQuotes(symbols, now);
    return NextResponse.json({ fetched, cached, remaining, errors });
  } catch (err) {
    console.error("quote warm failed", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "failed" }, { status: 500 });
  }
}
