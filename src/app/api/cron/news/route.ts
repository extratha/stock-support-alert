import { after, NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/auth";
import { collectNews, NewsError, runNewsBrief } from "@/lib/jobs/news";

export const dynamic = "force-dynamic";
/** Collecting reads up to ~100 article pages; the brief adds one long AI call. */
export const maxDuration = 300;

/**
 * Called by a scheduler (cron-job.org). Plain call: collect the latest news (hourly). `?mode=brief`: collect, then the
 * AI news brief, once per trading day (schedule it before the open, e.g. 08:30 New York); `?force=1` runs it anyway.
 * `?async=1` answers 202 at once and works in the background (the result is in the function log).
 */
export async function POST(request: Request) {
  if (!isCronAuthorized(request)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const params = new URL(request.url).searchParams;
  const brief = params.get("mode") === "brief";
  const force = params.get("force") === "1";
  const run = async () => {
    if (!brief) return collectNews();
    const view = await runNewsBrief({ trigger: "schedule", force });
    return view ? { brief: view.id, stocks: view.stocks.length, articles: view.refs.length, model: view.model } : { skipped: "not a trading day, or already done today" };
  };

  if (params.get("async") === "1") {
    after(async () => {
      try {
        console.log(`news ${brief ? "brief" : "collect"} (async)`, JSON.stringify(await run()));
      } catch (err) {
        console.error(`news ${brief ? "brief" : "collect"} (async) failed`, err);
      }
    });
    return NextResponse.json({ accepted: true }, { status: 202 });
  }
  try {
    return NextResponse.json(await run());
  } catch (err) {
    if (err instanceof NewsError) return NextResponse.json({ error: err.message, code: err.code }, { status: err.code === "no_news" ? 200 : 502 });
    console.error("news failed", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "failed" }, { status: 500 });
  }
}
