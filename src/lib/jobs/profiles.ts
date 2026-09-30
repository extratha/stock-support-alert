import { saveFundamentals, symbolsNeedingFundamentals } from "@/lib/db/profiles";
import { nyToday } from "@/lib/market/calendar";
import { fetchFundamentals } from "@/lib/profile/finnhub";

/** Fundamentals change quarterly; refreshing once a day is plenty. */
const MAX_AGE_HOURS = 20;
const CONCURRENCY = 5; // 2 Finnhub calls per symbol; the free plan allows 60/minute

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
      } catch (err) {
        errors[symbol] = err instanceof Error ? err.message : String(err);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, todo.length) }, worker));
  return { updated, errors };
}
