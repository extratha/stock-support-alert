import { NextResponse } from "next/server";
import { requireEnv } from "@/lib/config";
import { deactivateUser, upsertFollower } from "@/lib/db/lineUsers";
import { replyText } from "@/lib/line/client";
import { verifyLineSignature } from "@/lib/line/signature";

export const dynamic = "force-dynamic";

interface LineEvent {
  type: string;
  replyToken?: string;
  source?: { type: string; userId?: string };
}

/** LINE Messaging API webhook: registers users on follow, deactivates on unfollow. */
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
    }
  }
  return NextResponse.json({ ok: true });
}
