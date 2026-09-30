import { NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/auth";
import { backfillLogos } from "@/lib/jobs/logos";
import { refreshFundamentals } from "@/lib/jobs/profiles";
import { recalculateAll } from "@/lib/jobs/recalculateSupports";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Daily, after the US close (see .github/workflows/recalculate-supports.yml).
 * Handles at most API_CREDITS_PER_MINUTE symbols per call and reports `remaining`;
 * the workflow pauses and calls again. `?force=1` recomputes everything (walk it with `offset`).
 */
export async function POST(request: Request) {
  if (!isCronAuthorized(request)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const params = new URL(request.url).searchParams;
  const force = params.get("force") === "1";
  const offset = Number.parseInt(params.get("offset") ?? "0", 10) || 0;
  try {
    const result = await recalculateAll(new Date(), { force, offset });
    // Symbols still without a logo get a few attempts per run (each retried at most weekly). Never affects the result.
    const logos = await backfillLogos({ limit: 3 }).catch(() => null);
    // Fundamentals older than ~20 h (Finnhub; bounded to 20 s). Display only, never affects the result.
    const fundamentals = await refreshFundamentals().catch(() => null);
    return NextResponse.json({
      ...result,
      ...(logos && (logos.saved.length > 0 || Object.keys(logos.missing).length > 0) ? { logos } : {}),
      ...(fundamentals && (fundamentals.updated.length > 0 || Object.keys(fundamentals.errors).length > 0) ? { fundamentals } : {}),
    });
  } catch (err) {
    console.error("recalculate failed", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "failed" }, { status: 500 });
  }
}
