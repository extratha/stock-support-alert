import { config } from "@/lib/config";

export type AiErrorKind = "config" | "rate_limit" | "timeout" | "http" | "bad_response";

/** `message` is safe to show to the user: it never contains the key or the provider's raw reply. */
export class AiError extends Error {
  constructor(
    message: string,
    readonly kind: AiErrorKind,
    readonly status?: number,
  ) {
    super(message);
    this.name = "AiError";
  }
}

/** https only (the key travels in the request); plain http is allowed for a local server such as Ollama. */
export function chatCompletionsUrl(baseUrl: string): string {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new AiError("AI_BASE_URL ไม่ใช่ URL ที่ถูกต้อง", "config");
  }
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) {
    throw new AiError("AI_BASE_URL ต้องเป็น https://", "config");
  }
  return `${baseUrl.replace(/\/+$/, "")}/chat/completions`;
}

type Json = Record<string, unknown>;

/** OpenAI-style reply: `choices[0].message.content` is a string (some providers send a list of text parts). */
function contentOf(json: Json): string {
  const choice = (Array.isArray(json.choices) ? json.choices[0] : undefined) as Json | undefined;
  const content = (choice?.message as Json | undefined)?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map((p) => (typeof (p as Json)?.text === "string" ? String((p as Json).text) : "")).join("");
  }
  return "";
}

/** One chat completion (no retries: every call counts against the provider's quota). Returns the reply text. */
export async function chat({ system, user }: { system: string; user: string }): Promise<string> {
  const missing = config.ai.missing();
  if (missing.length > 0) throw new AiError(`ยังไม่ได้ตั้งค่า ${missing.join(", ")}`, "config");

  const temperature = config.ai.temperature();
  let res: Response;
  try {
    res = await fetch(chatCompletionsUrl(config.ai.baseUrl()), {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.ai.apiKey()}` },
      body: JSON.stringify({
        model: config.ai.model(),
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        ...(temperature === null ? {} : { temperature }),
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(config.ai.timeoutMs()),
    });
  } catch (err) {
    if (err instanceof AiError) throw err;
    if (err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError")) {
      throw new AiError(`AI ตอบไม่ทันใน ${config.ai.timeoutMs() / 1000} วินาที ลองใหม่อีกครั้ง หรือเลือกโมเดลที่เร็วกว่า`, "timeout");
    }
    throw new AiError("เชื่อมต่อผู้ให้บริการ AI ไม่ได้", "http");
  }

  if (!res.ok) {
    // the provider's text goes to the server log only (it can be long, and is not for the user)
    console.error("AI request failed", res.status, (await res.text().catch(() => "")).slice(0, 300));
    if (res.status === 429) throw new AiError("ผู้ให้บริการ AI จำกัดจำนวนครั้ง (rate limit / โควตาหมด) ลองใหม่ภายหลัง", "rate_limit", 429);
    if (res.status === 401 || res.status === 403) throw new AiError("ผู้ให้บริการ AI ปฏิเสธ key (ตรวจ AI_API_KEY)", "http", res.status);
    if (res.status === 404 || res.status === 400) throw new AiError("ผู้ให้บริการ AI ไม่รู้จักโมเดลหรือคำขอไม่ถูกต้อง (ตรวจ AI_MODEL / AI_BASE_URL)", "http", res.status);
    throw new AiError(`ผู้ให้บริการ AI ตอบ error (HTTP ${res.status})`, "http", res.status);
  }

  const text = contentOf((await res.json().catch(() => ({}))) as Json).trim();
  if (!text) throw new AiError("AI ไม่ได้ส่งคำตอบกลับมา ลองใหม่อีกครั้ง", "bad_response");
  return text;
}
