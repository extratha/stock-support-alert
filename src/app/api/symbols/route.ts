import { NextResponse } from "next/server";
import { config } from "@/lib/config";
import { listSymbols, SYMBOL_PATTERN } from "@/lib/db/symbols";
import { trackSymbol } from "@/lib/jobs/recalculateSupports";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ symbols: await listSymbols() });
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { symbol?: unknown } | null;
  const symbol = typeof body?.symbol === "string" ? body.symbol.trim().toUpperCase() : "";
  if (!SYMBOL_PATTERN.test(symbol)) {
    return NextResponse.json({ error: "รูปแบบ symbol ไม่ถูกต้อง (เช่น NVDA, BRK.B)" }, { status: 400 });
  }

  const existing = await listSymbols();
  if (existing.includes(symbol)) return NextResponse.json({ error: `${symbol} ถูก track อยู่แล้ว` }, { status: 409 });
  if (existing.length >= config.maxTrackedSymbols()) {
    return NextResponse.json(
      { error: `track ได้สูงสุด ${config.maxTrackedSymbols()} ตัว (ปรับได้ด้วย MAX_TRACKED_SYMBOLS)` },
      { status: 400 },
    );
  }

  const result = await trackSymbol(symbol, new Date());
  if (!result.ok) return NextResponse.json({ error: `เพิ่ม ${symbol} ไม่สำเร็จ: ${result.error}` }, { status: 502 });
  return NextResponse.json({ symbol }, { status: 201 });
}
