import { config } from "@/lib/config";
import { claimNotice, listRecipientIds, releaseNotice } from "@/lib/db/lineUsers";
import { listSymbols } from "@/lib/db/symbols";
import { pushText } from "@/lib/line/client";
import { formatNotifyEnabledNotice } from "@/lib/line/guide";

/** Friends with push switched on (see the "ผู้รับแจ้งเตือน" page), capped by MAX_PUSH_RECIPIENTS. */
export async function recipients(): Promise<string[]> {
  return listRecipientIds(config.maxPushRecipients());
}

export async function notify(texts: string | string[]): Promise<{ sent: number }> {
  const to = await recipients();
  if (to.length === 0) return { sent: 0 };
  await pushText(to, texts);
  return { sent: to.length };
}

/** At most one "push is ON" notice per user per this many hours (each one uses push quota). */
export const NOTICE_COOLDOWN_HOURS = 24;

export type NoticeResult = "sent" | "skipped" | "failed";

/**
 * Tell a user that alerts were just switched on for them. Never throws: turning alerts on must
 * succeed even when the push fails (e.g. the monthly quota is used up).
 */
export async function sendEnabledNotice(userId: string): Promise<NoticeResult> {
  if (!(await claimNotice(userId, NOTICE_COOLDOWN_HOURS))) return "skipped";
  try {
    const symbols = await listSymbols().catch(() => []);
    await pushText([userId], formatNotifyEnabledNotice(symbols));
    return "sent";
  } catch (err) {
    console.error("enabled-notice push failed", err);
    await releaseNotice(userId).catch(() => {});
    return "failed";
  }
}
