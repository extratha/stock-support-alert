import { requireEnv } from "@/lib/config";

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

/** Push one text message to many users (multicast = 1 request per 500 users). */
export async function pushText(userIds: string[], text: string) {
  for (let i = 0; i < userIds.length; i += MULTICAST_LIMIT) {
    await post("multicast", {
      to: userIds.slice(i, i + MULTICAST_LIMIT),
      messages: [{ type: "text", text }],
    });
  }
}

/** Reply messages are free and don't count toward the monthly push quota. */
export async function replyText(replyToken: string, text: string) {
  await post("reply", { replyToken, messages: [{ type: "text", text }] });
}
