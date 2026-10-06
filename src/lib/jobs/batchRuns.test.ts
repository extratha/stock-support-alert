import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// warmQuotes drives the real getQuotes: only the provider and the cache table are fakes
const cache = new Map<string, number>();
const fetchQuotes = vi.fn(async (symbols: string[]) => ({
  data: Object.fromEntries(symbols.map((s) => [s, { symbol: s, price: 1, previousClose: 1, dayLow: 1, quoteTime: new Date() }])),
  errors: {},
}));
vi.mock("@/lib/stock", () => ({ stockProvider: { getQuotes: fetchQuotes, getDailyCandles: vi.fn() } }));
vi.mock("@/lib/db/quotes", () => ({
  listCachedQuotes: vi.fn(async (symbols: string[]) =>
    symbols.filter((s) => cache.has(s)).map((s) => ({ symbol: s, price: 1, dayLow: 1, prevClose: 1, quoteTime: new Date(), fetchedAt: new Date(cache.get(s)!) })),
  ),
  upsertQuotes: vi.fn(async (qs: { symbol: string }[]) => qs.forEach((q) => cache.set(q.symbol, Date.now()))),
}));

const { warmQuotes, BATCH_PAUSE_MS } = await import("./quotes");

const symbols = Array.from({ length: 20 }, (_, i) => `S${i}`);

describe("warmQuotes", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-06T14:40:00Z"));
    cache.clear();
    fetchQuotes.mockClear();
    vi.stubEnv("API_CREDITS_PER_MINUTE", "8");
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it("fetches every symbol in per-minute batches of 8 (20 symbols = 3 batches, 2 pauses)", async () => {
    const done = warmQuotes(symbols, 200_000);
    await vi.advanceTimersByTimeAsync(3 * BATCH_PAUSE_MS);
    await done;
    expect(fetchQuotes.mock.calls.map(([s]) => s.length)).toEqual([8, 8, 4]);
    expect(cache.size).toBe(20);
  });

  it("does nothing more when every quote is already fresh (the workflow warmed them)", async () => {
    symbols.forEach((s) => cache.set(s, Date.now()));
    await warmQuotes(symbols, 200_000);
    expect(fetchQuotes).not.toHaveBeenCalled();
  });

  it("stops when the next pause would not fit the time budget", async () => {
    const done = warmQuotes(symbols, 90_000); // room for one pause only
    await vi.advanceTimersByTimeAsync(5 * BATCH_PAUSE_MS);
    await done;
    expect(fetchQuotes).toHaveBeenCalledTimes(2);
  });
});
