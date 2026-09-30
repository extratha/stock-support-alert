import { NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/auth";
import { recalculateAll } from "@/lib/jobs/recalculateSupports";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Daily, after the US close (see .github/workflows/recalculate.yml). `?force=1` ignores the freshness check. */
export async function POST(request: Request) {
  if (!isCronAuthorized(request)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const force = new URL(request.url).searchParams.get("force") === "1";
  try {
    return NextResponse.json(await recalculateAll(new Date(), { force }));
  } catch (err) {
    console.error("recalculate failed", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "failed" }, { status: 500 });
  }
}
