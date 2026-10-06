import { after, NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/auth";
import { checkAlerts } from "@/lib/jobs/checkAlerts";

export const dynamic = "force-dynamic";
/** One call does the whole check, quotes included (batches a minute apart), so it may take a few minutes. */
export const maxDuration = 300;

/**
 * Called by a scheduler (cron-job.org / GitHub Actions). The market-hours and daily-slot checks live here, so the
 * schedule can be loose. `?mode=daily` = the fixed daily checks, using today's low; `?force=1` bypasses the time checks
 * (manual testing). `?async=1` answers 202 at once and runs the check in the background: for schedulers that only wait
 * a few seconds for a reply (the result is in the function log).
 */
export async function POST(request: Request) {
  if (!isCronAuthorized(request)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const params = new URL(request.url).searchParams;
  const force = params.get("force") === "1";
  const mode = params.get("mode") === "daily" ? "daily" : "intraday";
  const run = () => checkAlerts(new Date(), { force, mode });

  if (params.get("async") === "1") {
    after(async () => {
      try {
        console.log("check (async)", JSON.stringify(await run()));
      } catch (err) {
        console.error("check (async) failed", err);
      }
    });
    return NextResponse.json({ accepted: true }, { status: 202 });
  }
  try {
    return NextResponse.json(await run());
  } catch (err) {
    console.error("check failed", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "failed" }, { status: 500 });
  }
}
