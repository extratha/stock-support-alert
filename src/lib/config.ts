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
};
