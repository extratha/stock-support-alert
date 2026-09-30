import { NextResponse } from "next/server";
import { config } from "@/lib/config";
import { setLabel, setNotify } from "@/lib/db/lineUsers";
import { sendEnabledNotice, type NoticeResult } from "@/lib/jobs/notify";
import { LINE_USER_ID_PATTERN, MAX_LABEL_LENGTH } from "@/lib/line/userId";

export const dynamic = "force-dynamic";

/**
 * Update one LINE friend from the "ผู้รับแจ้งเตือน" page (behind ADMIN_PASSWORD via proxy.ts).
 * Body: { notify?: boolean, label?: string | null }
 * Switching push ON (off -> on) also sends that user a one-off notice via LINE push
 * (rate-limited, costs 1 message of push quota); the response says what happened: `notice`.
 */
export async function PATCH(request: Request, ctx: { params: Promise<{ userId: string }> }) {
  const { userId } = await ctx.params;
  if (!LINE_USER_ID_PATTERN.test(userId)) return NextResponse.json({ error: "invalid userId" }, { status: 400 });

  const body = (await request.json().catch(() => null)) as { notify?: unknown; label?: unknown } | null;
  if (!body || (body.notify === undefined && body.label === undefined)) {
    return NextResponse.json({ error: "nothing to update" }, { status: 400 });
  }
  if (body.notify !== undefined && typeof body.notify !== "boolean") {
    return NextResponse.json({ error: "notify must be a boolean" }, { status: 400 });
  }
  if (body.label !== undefined && body.label !== null && typeof body.label !== "string") {
    return NextResponse.json({ error: "label must be a string" }, { status: 400 });
  }

  if (body.label !== undefined) {
    const trimmed = typeof body.label === "string" ? body.label.trim() : "";
    if (trimmed.length > MAX_LABEL_LENGTH) {
      return NextResponse.json({ error: `ชื่อเรียกยาวเกิน ${MAX_LABEL_LENGTH} ตัวอักษร` }, { status: 400 });
    }
    if (!(await setLabel(userId, trimmed || null))) return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  let notice: NoticeResult | undefined;
  if (body.notify !== undefined) {
    const max = config.maxPushRecipients();
    const result = await setNotify(userId, body.notify, max);
    if (result === "limit") {
      return NextResponse.json(
        { error: `เปิดรับแจ้งเตือนได้สูงสุด ${max} คน (เพื่อไม่ให้เกินโควตา push) — ปิดของคนอื่นก่อน` },
        { status: 409 },
      );
    }
    if (result === "inactive") {
      return NextResponse.json({ error: "คนนี้เลิกเป็นเพื่อนแล้ว จึงเปิดรับแจ้งเตือนไม่ได้" }, { status: 409 });
    }
    if (result === "not_found") return NextResponse.json({ error: "not found" }, { status: 404 });
    if (result === "enabled") notice = await sendEnabledNotice(userId);
  }

  return NextResponse.json({ ok: true, ...(notice ? { notice } : {}) });
}
