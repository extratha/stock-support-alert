import { config } from "@/lib/config";
import { listActiveUserIds } from "@/lib/db/lineUsers";
import { pushText } from "@/lib/line/client";

/** Active followers, narrowed by LINE_ALLOWED_USER_IDS when configured. */
export async function recipients(): Promise<string[]> {
  const active = await listActiveUserIds();
  const allowed = config.lineAllowedUserIds();
  return allowed.length > 0 ? active.filter((id) => allowed.includes(id)) : active;
}

export async function notify(texts: string | string[]): Promise<{ sent: number }> {
  const to = await recipients();
  if (to.length === 0) return { sent: 0 };
  await pushText(to, texts);
  return { sent: to.length };
}
