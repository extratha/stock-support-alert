import { saveAnalysts, saveFundamentals, symbolsNeedingAnalysts, symbolsNeedingFundamentals } from "@/lib/db/profiles";
import { nyToday } from "@/lib/market/calendar";
import { fetchAnalysts, fetchFundamentals } from "@/lib/profile/finnhub";

/** Fundamentals change quarterly; refreshing once a day is plenty. */
const MAX_AGE_HOURS = 20;
const CONCURRENCY = 5; // 2 Finnhub calls per symbol (+2 every few days for analysts); the free plan allows 60/minute
/** Analyst views move slowly; refreshing them every 3 days keeps a daily run well under 60 calls a minute. */
const ANALYSTS_MAX_AGE_HOURS = 72;

/**
 * Refresh stale fundamentals (up to `limit` symbols) under one overall deadline. Never throws; a symbol that fails
 * keeps its previous values and is retried on the next run.
 */
export async function refreshFundamentals({
  symbols,
  limit = 20,
  deadlineMs = 20_000,
  now = new Date(),
}: { symbols?: string[]; limit?: number; deadlineMs?: number; now?: Date } = {}) {
  const key = process.env.FINNHUB_API_KEY;
  const updated: string[] = [];
  const errors: Record<string, string> = {};
  if (!key) return { updated, errors: { "*": "FINNHUB_API_KEY is not set" } };

  const todo = symbols ?? (await symbolsNeedingFundamentals(MAX_AGE_HOURS, limit));
  const deadline = AbortSignal.timeout(deadlineMs);
  const today = nyToday(now);
  const analystsDue = await symbolsNeedingAnalysts(todo, ANALYSTS_MAX_AGE_HOURS).catch(() => new Set<string>());
  const targets = { allowed: true }; // flips off after the first "not on your plan"
  let next = 0;
  const worker = async () => {
    while (next < todo.length) {
      const symbol = todo[next++];
      if (deadline.aborted) {
        errors[symbol] = "deadline reached";
        continue;
      }
      try {
        await saveFundamentals(symbol, await fetchFundamentals(symbol, key, today, deadline));
        updated.push(symbol);
        if (analystsDue.has(symbol) && !deadline.aborted) {
          try {
            await saveAnalysts(symbol, await fetchAnalysts(symbol, key, targets, deadline));
          } catch (e) {
            console.error("analysts failed", symbol, e); // best effort: never fails the fundamentals
          }
        }
      } catch (err) {
        errors[symbol] = err instanceof Error ? err.message : String(err);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, todo.length) }, worker));
  return { updated, errors };
}
