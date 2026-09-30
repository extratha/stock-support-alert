import { NextResponse } from "next/server";
import { config, requireEnv } from "@/lib/config";
import { deactivateUser, upsertFollower } from "@/lib/db/lineUsers";
import { listTrackedSymbols } from "@/lib/db/symbols";
import { recipients } from "@/lib/jobs/notify";
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

/** Only owners (LINE_ALLOWED_USER_IDS, if set) may query; otherwise any registered follower. */
async function mayQuery(userId: string): Promise<boolean> {
  const allowed = config.lineAllowedUserIds();
  return allowed.length > 0 ? allowed.includes(userId) : (await recipients()).includes(userId);
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
      const command = parseSupportCommand(event.message.text ?? "");
      if (command && (await mayQuery(userId))) {
        const reply = formatSupportReply(await listTrackedSymbols(), command.symbols);
        await replyText(event.replyToken, reply).catch((e) => console.error("support reply failed", e));
      }
    }
  }
  return NextResponse.json({ ok: true });
}
