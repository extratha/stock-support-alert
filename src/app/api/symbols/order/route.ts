import { NextResponse } from "next/server";
import { SYMBOL_PATTERN, setSymbolOrder } from "@/lib/db/symbols";

export const dynamic = "force-dynamic";

/** Save the drag & drop order of the dashboard cards. Behind ADMIN_PASSWORD via proxy.ts. */
export async function PUT(request: Request) {
  const body = (await request.json().catch(() => null)) as { order?: unknown } | null;
  const order = body?.order;
  if (
    !Array.isArray(order) ||
    order.length > 100 ||
    !order.every((s) => typeof s === "string" && SYMBOL_PATTERN.test(s))
  ) {
    return NextResponse.json({ error: "invalid order" }, { status: 400 });
  }
  return NextResponse.json({ order: await setSymbolOrder(order as string[]) });
}
