import { NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/auth";
import { checkAlerts } from "@/lib/jobs/checkAlerts";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Every 30 min (see .github/workflows/check-alerts.yml). Cron runs in UTC and
 * ignores DST, so the schedule is a superset and the market-hours check lives here.
 * `?force=1` bypasses that check (manual testing).
 */
export async function POST(request: Request) {
  if (!isCronAuthorized(request)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const force = new URL(request.url).searchParams.get("force") === "1";
  try {
    return NextResponse.json(await checkAlerts(new Date(), { force }));
  } catch (err) {
    console.error("check failed", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "failed" }, { status: 500 });
  }
}
