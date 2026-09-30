import { NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/auth";
import { checkAlerts } from "@/lib/jobs/checkAlerts";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Called by .github/workflows/check-alerts.yml. Cron runs in UTC and ignores DST,
 * so the schedule is a superset and the market-hours check lives here.
 * `?mode=daily` = once-a-day run 4h after the open using today's low;
 * `?force=1` bypasses the time checks (manual testing).
 */
export async function POST(request: Request) {
  if (!isCronAuthorized(request)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const params = new URL(request.url).searchParams;
  const force = params.get("force") === "1";
  const mode = params.get("mode") === "daily" ? "daily" : "intraday";
  try {
    return NextResponse.json(await checkAlerts(new Date(), { force, mode }));
  } catch (err) {
    console.error("check failed", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "failed" }, { status: 500 });
  }
}
