import { NextResponse } from "next/server";
import { parseGoals } from "@/lib/analysis/types";
import { AnalysisError, manualPrompt } from "@/lib/jobs/analysis";

export const dynamic = "force-dynamic";
export const maxDuration = 20;

/**
 * POST { goals } -> { text }: the analysis prompt with the current data, for the user to paste into an AI chat
 * themselves. Calls no AI and uses no quota. Behind the login (proxy.ts).
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { goals?: unknown } | null;
  if (body === null || typeof body !== "object") return NextResponse.json({ error: "คำขอไม่ถูกต้อง" }, { status: 400 });
  const goals = parseGoals(body.goals ?? []);
  if (goals === null) return NextResponse.json({ error: "เป้าหมายไม่ถูกต้อง" }, { status: 400 });
  try {
    return NextResponse.json({ text: await manualPrompt(goals) });
  } catch (err) {
    if (err instanceof AnalysisError) return NextResponse.json({ error: err.message }, { status: err.code === "no_symbols" ? 409 : 500 });
    console.error("/api/analysis/prompt failed", err);
    return NextResponse.json({ error: "สร้างข้อความไม่สำเร็จ ลองใหม่อีกครั้ง" }, { status: 500 });
  }
}
