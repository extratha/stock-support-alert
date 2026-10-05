import { TIERS, type Tier } from "@/lib/support/types";

/** Environment access. Values are read lazily so `next build` works without secrets. */
export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

const num = (name: string, fallback: number) => {
  const raw = process.env[name];
  const n = raw === undefined || raw === "" ? NaN : Number(raw);
  return Number.isFinite(n) ? n : fallback;
};

const DEFAULT_AI_BASE_URL = "https://openrouter.ai/api/v1";

export const config = {
  /** How many symbols may be tracked. Larger lists are fetched in rate-limited batches. */
  maxTrackedSymbols: () => num("MAX_TRACKED_SYMBOLS", 20),
  /** Live dashboard prices are shared through the DB and reused for this long (protects the free API limits). */
  livePriceTtlSeconds: () => Math.max(0, num("LIVE_PRICE_TTL_SECONDS", 300)),
  /** The "รีเฟรชราคา" button can bypass the cache, but never more often than this per symbol. */
  livePriceMinRefreshSeconds: () => Math.max(0, num("LIVE_PRICE_MIN_REFRESH_SECONDS", 30)),
  /** Hard ceiling for one live-price request, all symbols and all sources together (page budget is 15 s). */
  livePriceDeadlineMs: () => Math.max(1000, num("LIVE_PRICE_DEADLINE_MS", 12_000)),
  /**
   * Twelve Data free plan: 8 API credits/minute, one credit per symbol per request.
   * Every job fetches at most this many symbols per call; the workflow loops with a
   * pause between calls until nothing is left (see .github/workflows).
   */
  apiCreditsPerMinute: () => Math.max(1, Math.floor(num("API_CREDITS_PER_MINUTE", 8))),
  /** A cached quote younger than this is reused instead of calling the API again. */
  quoteCacheTtlMinutes: () => num("QUOTE_CACHE_TTL_MINUTES", 5),
  /**
   * Max friends that receive push alerts (each push message counts once per recipient
   * against LINE's monthly quota). Friends beyond this can still ask "ขอแนวรับ" for free.
   */
  maxPushRecipients: () => Math.max(0, Math.floor(num("MAX_PUSH_RECIPIENTS", 5))),
  /**
   * Tiers that send LINE alerts. Default: only "major" (แนวรับสำคัญ), the only tier the backtest found better than
   * buying on a random day. ALERT_TIERS=minor,intermediate,major restores all three. Unknown names are ignored.
   */
  /**
   * AI stock ranking (the "วิเคราะห์ด้วย AI" page). Any provider with an OpenAI-compatible
   * `POST {AI_BASE_URL}/chat/completions` works (OpenRouter, Gemini, Groq, OpenAI, ...). The key is a secret.
   */
  ai: {
    baseUrl: () => (process.env.AI_BASE_URL?.trim() || DEFAULT_AI_BASE_URL).replace(/\/+$/, ""),
    apiKey: () => process.env.AI_API_KEY?.trim() ?? "",
    /**
     * AI_MODEL is one model, or several separated by commas: the first is the default, the others are tried in order
     * when it cannot be used (quota used up, overloaded, retired) and can be picked on the page. Duplicates are dropped.
     */
    models: (): string[] => [...new Set((process.env.AI_MODEL ?? "").split(",").map((m) => m.trim()).filter(Boolean))],
    model: (): string => config.ai.models()[0] ?? "",
    /** Sent only when set: some newer models reject any value but their default. */
    temperature: () => {
      const raw = process.env.AI_TEMPERATURE;
      const n = raw === undefined || raw.trim() === "" ? NaN : Number(raw);
      return Number.isFinite(n) ? Math.min(2, Math.max(0, n)) : null;
    },
    /** Runs per New York day, failed ones included (each costs quota with the provider). */
    dailyLimit: () => Math.max(1, Math.floor(num("AI_DAILY_LIMIT", 10))),
    /** The whole run (prices up to 8 s + this) must fit in the serverless function's 60 s. */
    timeoutMs: () => Math.min(50, Math.max(5, num("AI_TIMEOUT_SECONDS", 40))) * 1000,
    /** Names of the variables still missing (empty = ready). */
    missing: (): string[] => [
      ...(process.env.AI_API_KEY?.trim() ? [] : ["AI_API_KEY"]),
      ...(config.ai.models().length > 0 ? [] : ["AI_MODEL"]),
    ],
  },
  alertTiers: (): Tier[] => {
    const raw = process.env.ALERT_TIERS?.split(",").map((t) => t.trim()).filter((t): t is Tier => (TIERS as readonly string[]).includes(t));
    return raw && raw.length > 0 ? raw : ["major"];
  },
};
