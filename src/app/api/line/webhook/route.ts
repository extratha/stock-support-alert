import { NextResponse } from "next/server";
import { requireEnv } from "@/lib/config";
import { deactivateUser, ensureFriend, upsertFollower } from "@/lib/db/lineUsers";
import { listSymbols, listTrackedSymbols } from "@/lib/db/symbols";
import { syncProfile } from "@/lib/jobs/lineProfiles";
import { replyText } from "@/lib/line/client";
import { formatGuide, isHelpCommand } from "@/lib/line/guide";
import { verifyLineSignature } from "@/lib/line/signature";
import { formatSupportReply, parseSupportCommand } from "@/lib/line/supportCommand";

export const dynamic = "force-dynamic";

interface LineEvent {
  type: string;
  replyToken?: string;
  source?: { type: string; userId?: string };
  message?: { type: string; text?: string };
}

/** Usage guide with the stocks currently tracked; if the DB hiccups the guide is still sent. */
async function guide(welcome: boolean): Promise<string> {
  const symbols = await listSymbols().catch(() => []);
  return formatGuide(symbols, { welcome });
}

/**
 * LINE Messaging API webhook.
 *  - follow / unfollow: keep the friend list (line_users) up to date; push stays OFF for new friends.
 *  - follow: a usage guide (how to ask "ขอแนวรับ ...") is sent as the welcome message.
 *  - any message: the sender is a friend; "ขอแนวรับ [SYMBOL...]" is answered for every friend,
 *    and "วิธีใช้" / "help" repeats the guide.
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
        await replyText(event.replyToken, await guide(true)).catch((e) => console.error("welcome reply failed", e));
      }
    } else if (event.type === "unfollow") {
      await deactivateUser(userId);
    } else if (event.type === "message") {
      const { needsProfile } = await ensureFriend(userId);
      if (needsProfile) await syncProfile(userId);

      const text = event.message?.type === "text" ? (event.message.text ?? "") : "";
      const command = parseSupportCommand(text);
      if (isHelpCommand(text) && event.replyToken) {
        await replyText(event.replyToken, await guide(false)).catch((e) => console.error("help reply failed", e));
      } else if (command && event.replyToken) {
        const reply = formatSupportReply(await listTrackedSymbols(), command.symbols);
        await replyText(event.replyToken, reply).catch((e) => console.error("reply failed", e));
      }
    }
  }
  return NextResponse.json({ ok: true });
}
