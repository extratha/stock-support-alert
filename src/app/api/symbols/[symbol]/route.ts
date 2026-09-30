import { NextResponse } from "next/server";
import { removeSymbol, SYMBOL_PATTERN } from "@/lib/db/symbols";

export const dynamic = "force-dynamic";

export async function DELETE(_request: Request, ctx: { params: Promise<{ symbol: string }> }) {
  const symbol = decodeURIComponent((await ctx.params).symbol).toUpperCase();
  if (!SYMBOL_PATTERN.test(symbol)) return NextResponse.json({ error: "invalid symbol" }, { status: 400 });
  const removed = await removeSymbol(symbol);
  return NextResponse.json({ removed }, { status: removed ? 200 : 404 });
}
