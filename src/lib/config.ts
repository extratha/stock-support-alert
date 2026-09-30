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
  alertTiers: (): Tier[] => {
    const raw = process.env.ALERT_TIERS?.split(",").map((t) => t.trim()).filter((t): t is Tier => (TIERS as readonly string[]).includes(t));
    return raw && raw.length > 0 ? raw : ["major"];
  },
};
