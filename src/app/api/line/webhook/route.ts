import { NextResponse } from "next/server";
import { requireEnv } from "@/lib/config";
import { deactivateUser, ensureFriend, upsertFollower } from "@/lib/db/lineUsers";
import { listTrackedSymbols } from "@/lib/db/symbols";
import { syncProfile } from "@/lib/jobs/lineProfiles";
import { replyText } from "@/lib/line/client";
import { verifyLineSignature } from "@/lib/line/signature";
import { formatSupportReply, parseSupportCommand } from "@/lib/line/supportCommand";

export const dynamic = "force-dynamic";

interface LineEvent {
  type: string;
  replyToken?: string;
  source?: { type: string; userId?: string };
  message?: { type: string; text?: string };
}

const WELCOME =
  'เพิ่มเป็นเพื่อนแล้ว ✅\nพิมพ์ "ขอแนวรับ" เพื่อดูแนวรับปัจจุบัน (หรือ "ขอแนวรับ NVDA" เฉพาะตัวที่ต้องการ)\n' +
  "การแจ้งเตือนอัตโนมัติต้องให้เจ้าของระบบเปิดรับให้ก่อน";

/**
 * LINE Messaging API webhook.
 *  - follow / unfollow: keep the friend list (line_users) up to date; push stays OFF for new friends.
 *  - any message: the sender is a friend; "ขอแนวรับ [SYMBOL...]" is answered for every friend.
 *    Replies are free (they do not count toward the monthly push quota).
 */
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
      await syncProfile(userId);
      if (event.replyToken) {
        await replyText(event.replyToken, WELCOME).catch((e) => console.error("welcome reply failed", e));
      }
    } else if (event.type === "unfollow") {
      await deactivateUser(userId);
    } else if (event.type === "message") {
      const { needsProfile } = await ensureFriend(userId);
      if (needsProfile) await syncProfile(userId);

      const command = event.message?.type === "text" ? parseSupportCommand(event.message.text ?? "") : null;
      if (command && event.replyToken) {
        const reply = formatSupportReply(await listTrackedSymbols(), command.symbols);
        await replyText(event.replyToken, reply).catch((e) => console.error("reply failed", e));
      }
    }
  }
  return NextResponse.json({ ok: true });
}
