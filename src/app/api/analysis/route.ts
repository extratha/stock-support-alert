import { NextResponse } from "next/server";
import { parseGoals } from "@/lib/analysis/types";
import { runsOnDay } from "@/lib/db/analyses";
import { nyToday } from "@/lib/market/calendar";
import { AnalysisError, runAnalysis, type AnalysisErrorCode } from "@/lib/jobs/analysis";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const STATUS: Record<AnalysisErrorCode, number> = {
  bad_request: 400,
  not_configured: 503,
  no_symbols: 409,
  limit: 429,
  timeout: 504,
  ai: 502,
  parse: 502,
};

/** Runs used today, so the page shows the real count (null if it cannot be read: the page keeps what it had). */
const usedToday = () => runsOnDay(nyToday()).catch(() => null);

/**
 * POST { goals: GoalId[], model?: string } -> { analysis, used }. `model` must be one of the models in AI_MODEL. Behind the login (proxy.ts). Goals are checked against the fixed list, so
 * nothing the user types ever reaches the prompt.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { goals?: unknown; model?: unknown } | null;
  if (body === null || typeof body !== "object") return NextResponse.json({ error: "คำขอไม่ถูกต้อง" }, { status: 400 });
  const goals = parseGoals(body.goals ?? []);
  if (goals === null) return NextResponse.json({ error: "เป้าหมายไม่ถูกต้อง" }, { status: 400 });
  if (body.model !== undefined && typeof body.model !== "string") return NextResponse.json({ error: "โมเดลไม่ถูกต้อง" }, { status: 400 });

  try {
    const analysis = await runAnalysis(goals, { model: body.model });
    return NextResponse.json({ analysis, used: await usedToday() });
  } catch (err) {
    if (err instanceof AnalysisError) return NextResponse.json({ error: err.message, used: await usedToday() }, { status: STATUS[err.code] });
    console.error("/api/analysis failed", err);
    return NextResponse.json({ error: "วิเคราะห์ไม่สำเร็จ ลองใหม่อีกครั้ง", used: await usedToday() }, { status: 500 });
  }
}
