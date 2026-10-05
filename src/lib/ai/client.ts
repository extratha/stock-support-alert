import { config } from "@/lib/config";

export type AiErrorKind = "config" | "rate_limit" | "timeout" | "http" | "bad_response";

/**
 * `message` is safe to show to the user: it never contains the key.
 * `billable` = the provider may have done the work (it timed out, or answered with nothing), so the run counts toward
 * the daily limit. A request the provider turned away (bad key or model, over quota, overloaded) costs nothing.
 */
export class AiError extends Error {
  readonly billable: boolean;
  constructor(
    message: string,
    readonly kind: AiErrorKind,
    readonly status?: number,
    billable?: boolean,
  ) {
    super(message);
    this.name = "AiError";
    this.billable = billable ?? (kind === "timeout" || kind === "bad_response");
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

/** One request to one model. The whole reply text, or an AiError. No retry here. */
async function chatOnce(model: string, system: string, user: string, timeoutMs: number): Promise<string> {
  const temperature = config.ai.temperature();
  let res: Response;
  try {
    res = await fetch(chatCompletionsUrl(config.ai.baseUrl()), {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.ai.apiKey()}` },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        ...(temperature === null ? {} : { temperature }),
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    if (err instanceof AiError) throw err;
    if (err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError")) {
      throw new AiError(`AI ตอบไม่ทันใน ${Math.round(timeoutMs / 1000)} วินาที ลองใหม่อีกครั้ง หรือเลือกโมเดลที่เร็วกว่า`, "timeout");
    }
    throw new AiError("เชื่อมต่อผู้ให้บริการ AI ไม่ได้", "http");
  }

  if (!res.ok) {
    const raw = await res.text().catch(() => "");
    console.error("AI request failed", model, res.status, raw.slice(0, 300));
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

/** A model that did not work, and why in a few words (shown next to the result that a later model produced). */
export interface SkippedModel {
  model: string;
  reason: string;
}

export interface ChatResult {
  text: string;
  /** the model that actually answered */
  model: string;
  /** earlier models that could not be used, in the order tried */
  skipped: SkippedModel[];
}

const RETRY_DELAY_MS = 2000;
/** Not worth starting another request with less than this left of the budget. */
const MIN_ATTEMPT_MS = 3000;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
/** The provider failed or could not be reached: worth one more try on the same model. */
const transient = (e: AiError) => e.kind === "http" && (e.status === undefined || e.status >= 500);

function shortReason(e: AiError): string {
  if (e.kind === "rate_limit") return "โควตาหมดหรือถูกจำกัด (429)";
  if (e.kind === "http") return e.status === undefined ? "เชื่อมต่อไม่ได้" : e.status >= 500 ? `ผู้ให้บริการขัดข้อง/คนใช้เยอะ (HTTP ${e.status})` : `ไม่รู้จักโมเดลหรือถูกปฏิเสธ (HTTP ${e.status})`;
  if (e.kind === "bad_response") return "ไม่มีคำตอบ";
  return e.message;
}

/**
 * Ask the models in order until one answers. Everything shares ONE time budget (AI_TIMEOUT_SECONDS), so the run still
 * fits the serverless function's 60 s. Per model:
 *   - overloaded or unreachable (5xx / network): one more try after a short pause, then the next model
 *   - 429 (quota used up), 400/404 (model gone or refused), an empty reply: straight to the next model
 *   - a wrong key (401/403), a missing setting, or running out of time: stop, other models would fail the same way
 * Models have separate quotas with Google, so a later model usually works when the first one is used up for the day.
 */
export async function chat({ system, user, models = config.ai.models() }: { system: string; user: string; models?: string[] }): Promise<ChatResult> {
  const missing = config.ai.missing();
  if (missing.length > 0) throw new AiError(`ยังไม่ได้ตั้งค่า ${missing.join(", ")}`, "config");

  const deadline = Date.now() + config.ai.timeoutMs();
  const skipped: SkippedModel[] = [];
  let last: AiError | undefined;
  let billable = false;

  outer: for (const model of models) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const left = deadline - Date.now();
      if (left < MIN_ATTEMPT_MS) {
        if (attempt > 0) skipped.push({ model, reason: shortReason(last!) }); // this model was tried and failed; no time for more
        break outer;
      }
      try {
        return { text: await chatOnce(model, system, user, left), model, skipped };
      } catch (err) {
        if (!(err instanceof AiError)) throw err;
        last = err;
        billable ||= err.billable;
        if (err.kind === "timeout" || err.kind === "config" || err.status === 401 || err.status === 403) throw err;
        if (transient(err) && attempt === 0) {
          await sleep(RETRY_DELAY_MS);
          continue;
        }
        break;
      }
    }
    skipped.push({ model, reason: shortReason(last!) });
  }

  if (!last) throw new AiError("หมดเวลาก่อนเรียก AI", "timeout");
  // one model: its own message already says everything; several: list what happened to each
  if (models.length === 1) throw last;
  throw new AiError(
    `ลองแล้ว ${skipped.length} โมเดลแต่ไม่สำเร็จ — ${skipped.map((s) => `${s.model}: ${s.reason}`).join(" | ")} · ข้อความล่าสุด: ${last.message}`,
    last.kind,
    last.status,
    billable,
  );
}
