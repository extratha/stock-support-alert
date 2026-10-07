import { requireEnv } from "@/lib/config";
import { LINE_MAX_MESSAGES } from "./text";

const API = "https://api.line.me/v2/bot/message";
const MULTICAST_LIMIT = 500;

async function post(path: string, body: unknown) {
  const res = await fetch(`${API}/${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${requireEnv("LINE_CHANNEL_ACCESS_TOKEN")}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`LINE API ${path} failed: ${res.status} ${await res.text()}`);
}

const toMessages = (texts: string | string[]) =>
  [texts].flat().slice(0, LINE_MAX_MESSAGES).map((text) => ({ type: "text", text }));

/** Push text message(s) to many users (multicast = 1 request per 500 users). */
export async function pushText(userIds: string[], texts: string | string[]) {
  for (let i = 0; i < userIds.length; i += MULTICAST_LIMIT) {
    await post("multicast", { to: userIds.slice(i, i + MULTICAST_LIMIT), messages: toMessages(texts) });
  }
}

/** Reply messages are free and don't count toward the monthly push quota. */
export async function replyText(replyToken: string, texts: string | string[]) {
  await post("reply", { replyToken, messages: toMessages(texts) });
}

export interface LineProfile {
  displayName: string;
  pictureUrl?: string;
}

/**
 * The Messaging API exposes the display name and picture only. It never reveals the
 * user's LINE ID. Returns null when the user is not (or no longer) a friend.
 */
export async function getProfile(userId: string): Promise<LineProfile | null> {
  const res = await fetch(`https://api.line.me/v2/bot/profile/${encodeURIComponent(userId)}`, {
    headers: { Authorization: `Bearer ${requireEnv("LINE_CHANNEL_ACCESS_TOKEN")}` },
    cache: "no-store",
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`LINE profile failed: ${res.status} ${await res.text()}`);
  return (await res.json()) as LineProfile;
}
