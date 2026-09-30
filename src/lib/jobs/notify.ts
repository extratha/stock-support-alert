import { config } from "@/lib/config";
import { listRecipientIds } from "@/lib/db/lineUsers";
import { pushText } from "@/lib/line/client";

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
