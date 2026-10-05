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

/**
 * The reason the provider gave, for the admin who is configuring this ("API key not valid", "model not found"...):
 * `error.message` of a JSON reply (OpenAI-style object or Google's one-element array), or a short plain-text body.
 * Shortened, and anything shaped like a key (and the configured key itself) is blanked out.
 */
export function providerReason(body: string, apiKey = config.ai.apiKey()): string {
  let text = "";
  try {
    const parsed = JSON.parse(body) as unknown;
    const first = (Array.isArray(parsed) ? parsed[0] : parsed) as Json | undefined;
    const err = first?.error as Json | string | undefined;
    const message = typeof err === "string" ? err : err?.message ?? first?.message;
    if (typeof message === "string") text = message;
  } catch {
    if (!body.trimStart().startsWith("<")) text = body; // an HTML error page is no help
  }
  if (apiKey) text = text.split(apiKey).join("***");
  return text.replace(/[A-Za-z0-9_-]{32,}/g, "***").replace(/\s+/g, " ").trim().slice(0, 200);
}

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
    const raw = await res.text().catch(() => "");
    console.error("AI request failed", res.status, raw.slice(0, 300));
    const reason = providerReason(raw);
    const why = reason ? ` — ผู้ให้บริการแจ้งว่า: "${reason}"` : "";
    if (res.status === 429) throw new AiError(`ผู้ให้บริการ AI จำกัดจำนวนครั้ง (rate limit / โควตาหมด) ลองใหม่ภายหลัง${why}`, "rate_limit", 429);
    if (res.status === 401 || res.status === 403) throw new AiError(`ผู้ให้บริการ AI ปฏิเสธ key (ตรวจ AI_API_KEY)${why}`, "http", res.status);
    if (res.status === 404 || res.status === 400) {
      // Google answers 400 for a wrong key, so the key is the first thing to check, then the model and the URL
      throw new AiError(`ผู้ให้บริการ AI ปฏิเสธคำขอ (HTTP ${res.status}) ตรวจ AI_API_KEY, AI_MODEL, AI_BASE_URL${why}`, "http", res.status);
    }
    throw new AiError(`ผู้ให้บริการ AI ตอบ error (HTTP ${res.status})${why}`, "http", res.status);
  }

  const text = contentOf((await res.json().catch(() => ({}))) as Json).trim();
  if (!text) throw new AiError("AI ไม่ได้ส่งคำตอบกลับมา ลองใหม่อีกครั้ง", "bad_response");
  return text;
}
