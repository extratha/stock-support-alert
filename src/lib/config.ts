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
  /** Twelve Data free plan allows 8 API credits/minute; one credit per symbol per request. */
  maxTrackedSymbols: () => num("MAX_TRACKED_SYMBOLS", 8),
  /** A cached quote younger than this is reused instead of calling the API again. */
  quoteCacheTtlMinutes: () => num("QUOTE_CACHE_TTL_MINUTES", 5),
  /** Optional comma-separated LINE userIds; when set only these receive pushes. */
  lineAllowedUserIds: () =>
    (process.env.LINE_ALLOWED_USER_IDS ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
};
