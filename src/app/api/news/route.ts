import { NextResponse } from "next/server";
import { briefsOnDay } from "@/lib/db/news";
import { nyToday } from "@/lib/market/calendar";
import { NewsError, runNewsBrief, type NewsErrorCode } from "@/lib/jobs/news";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const STATUS: Record<NewsErrorCode, number> = {
  not_configured: 503,
  no_symbols: 409,
  no_news: 404,
  limit: 429,
  timeout: 504,
  ai: 502,
  parse: 502,
};

const usedToday = () => briefsOnDay(nyToday()).catch(() => null);

/** POST -> { brief, used }: collect the latest news and summarise it now. Behind the login (proxy.ts). */
export async function POST() {
  try {
    const brief = await runNewsBrief({ trigger: "manual" });
    return NextResponse.json({ brief, used: await usedToday() });
  } catch (err) {
    if (err instanceof NewsError) return NextResponse.json({ error: err.message, used: await usedToday() }, { status: STATUS[err.code] });
    console.error("/api/news failed", err);
    return NextResponse.json({ error: "สรุปข่าวไม่สำเร็จ ลองใหม่อีกครั้ง", used: await usedToday() }, { status: 500 });
  }
}
