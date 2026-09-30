import { NextResponse } from "next/server";
import { config, requireEnv } from "@/lib/config";
import { deactivateUser, listActiveUserIds, upsertFollower } from "@/lib/db/lineUsers";
import { listTrackedSymbols } from "@/lib/db/symbols";
import { replyText } from "@/lib/line/client";
import { formatSupportReply, parseSupportCommand } from "@/lib/line/supportCommand";
import { verifyLineSignature } from "@/lib/line/signature";

export const dynamic = "force-dynamic";

interface LineEvent {
  type: string;
  replyToken?: string;
  source?: { type: string; userId?: string };
  message?: { type: string; text?: string };
}

/**
 * Who may query / receive alerts: LINE_ALLOWED_USER_IDS when set, otherwise any
 * registered follower. Owners in the allow-list are (re)registered on their first
 * message, so a missed `follow` event (e.g. added the OA before the webhook worked)
 * heals itself.
 */
async function authorize(userId: string): Promise<boolean> {
  const allowed = config.lineAllowedUserIds();
  const active = await listActiveUserIds();
  if (allowed.length === 0) return active.includes(userId);
  if (!allowed.includes(userId)) return false;
  if (!active.includes(userId)) await upsertFollower(userId);
  return true;
}

/** LINE Messaging API webhook: registers users on follow, deactivates on unfollow, answers "ขอแนวรับ [SYMBOL...]". */
export async function POST(request: Request) {
  const raw = await request.text(); // signature is over the exact raw body
  if (!verifyLineSignature(raw, request.headers.get("x-line-signature"), requireEnv("LINE_CHANNEL_SECRET"))) {
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }

  const { events = [] } = JSON.parse(raw) as { events?: LineEvent[] };
  for (const event of events) {
    const userId = event.source?.userId;
    if (!userId) continue;

    if (event.type === "follow") {
      await upsertFollower(userId);
      if (event.replyToken) {
        await replyText(event.replyToken, "ลงทะเบียนรับแจ้งเตือนแนวรับหุ้น US เรียบร้อยแล้ว ✅").catch((e) =>
          console.error("welcome reply failed", e),
        );
      }
    } else if (event.type === "unfollow") {
      await deactivateUser(userId);
    } else if (event.type === "message" && event.message?.type === "text" && event.replyToken) {
      const authorized = await authorize(userId);
      const command = parseSupportCommand(event.message.text ?? "");
      if (command) {
        // Unauthorized users get their own userId back so the owner can put it in LINE_ALLOWED_USER_IDS.
        const reply = authorized
          ? formatSupportReply(await listTrackedSymbols(), command.symbols)
          : `ยังไม่ได้ลงทะเบียนรับข้อมูล\nuserId ของคุณ: ${userId}\n(เจ้าของระบบใส่ค่านี้ใน LINE_ALLOWED_USER_IDS หรือ block/unblock OA เพื่อลงทะเบียนใหม่)`;
        await replyText(event.replyToken, reply).catch((e) => console.error("reply failed", e));
      }
    }
  }
  return NextResponse.json({ ok: true });
}
