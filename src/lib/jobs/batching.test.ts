import { beforeEach, describe, expect, it, vi } from "vitest";

const getQuotesApi = vi.fn();
const getCandlesApi = vi.fn();
vi.mock("@/lib/stock", () => ({ stockProvider: { getQuotes: getQuotesApi, getDailyCandles: getCandlesApi } }));
vi.mock("@/lib/db/quotes", () => ({ listCachedQuotes: vi.fn(async () => []), upsertQuotes: vi.fn(async () => {}) }));
vi.mock("@/lib/db/supports", () => ({
  supportAsOfBySymbol: vi.fn(async () => ({})),
  replaceSupports: vi.fn(async () => {}),
  replaceSupportTests: vi.fn(async () => {}),
  listSupports: vi.fn(async () => []),
}));
vi.mock("@/lib/db/alerts", () => ({ loadStates: vi.fn(async () => new Map()), stateKey: (s: string, t: string) => `${s}:${t}` }));
vi.mock("@/lib/db/symbols", () => ({ addSymbol: vi.fn(), listSymbols: vi.fn(), removeSymbol: vi.fn() }));
const saveHistoryStats = vi.fn<(symbol: string, stats: unknown) => Promise<void>>(async () => {});
vi.mock("@/lib/db/profiles", () => ({ saveHistoryStats }));

const symbols = Array.from({ length: 20 }, (_, i) => `S${String(i).padStart(2, "0")}`);
const now = new Date("2026-09-30T18:00:00Z");

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.API_CREDITS_PER_MINUTE;
});

describe("getQuotes with more symbols than the per-minute API limit", () => {
  it("fetches only the first 8, defers the rest and reports them", async () => {
    getQuotesApi.mockImplementation(async (batch: string[]) => ({
      data: Object.fromEntries(batch.map((s) => [s, { symbol: s, price: 10, previousClose: null, dayLow: 9, quoteTime: now }])),
      errors: {},
    }));
    const { getQuotes } = await import("./quotes");
    const result = await getQuotes(symbols, now);

    expect(getQuotesApi).toHaveBeenCalledTimes(1);
    expect(getQuotesApi.mock.calls[0][0]).toEqual(symbols.slice(0, 8));
    expect(result.fetched).toBe(8);
    expect(result.remaining).toBe(12);
    expect(Object.keys(result.prices)).toHaveLength(8);
    expect(result.errors[symbols[8]]).toMatch(/deferred/);
  });

  it("honours API_CREDITS_PER_MINUTE", async () => {
    process.env.API_CREDITS_PER_MINUTE = "3";
    getQuotesApi.mockResolvedValue({ data: {}, errors: {} });
    const { getQuotes } = await import("./quotes");
    const result = await getQuotes(symbols, now);
    expect(getQuotesApi.mock.calls[0][0]).toHaveLength(3);
    expect(result.remaining).toBe(17);
  });
});

describe("recalculate with more symbols than the per-minute API limit", () => {
  const candles = Array.from({ length: 60 }, (_, i) => ({
    date: new Date(Date.UTC(2026, 6, 1 + i)).toISOString().slice(0, 10),
    open: 100, high: 102 + (i % 3), low: 98 - (i % 2), close: 100 + (i % 5), volume: 1,
  }));

  it("processes one batch, then walks the list with offset when forced", async () => {
    getCandlesApi.mockImplementation(async (batch: string[]) => ({
      data: Object.fromEntries(batch.map((s) => [s, candles])),
      errors: {},
    }));
    const { recalculate } = await import("./recalculateSupports");

    const first = await recalculate(symbols, now, { force: true, offset: 0 });
    expect(getCandlesApi.mock.calls[0][0]).toEqual(symbols.slice(0, 8));
    expect(first).toMatchObject({ remaining: 12, next: 8 });

    const second = await recalculate(symbols, now, { force: true, offset: first.next });
    expect(getCandlesApi.mock.calls[1][0]).toEqual(symbols.slice(8, 16));
    expect(second).toMatchObject({ remaining: 4, next: 16 });

    const third = await recalculate(symbols, now, { force: true, offset: second.next });
    expect(getCandlesApi.mock.calls[2][0]).toEqual(symbols.slice(16));
    expect(third).toMatchObject({ remaining: 0, next: 20 });
  });

  it("asks for ~5 years of bars (same credit cost) and stores the history stats for each symbol", async () => {
    getCandlesApi.mockImplementation(async (batch: string[]) => ({ data: Object.fromEntries(batch.map((s) => [s, candles])), errors: {} }));
    const { recalculate } = await import("./recalculateSupports");
    await recalculate(symbols.slice(0, 2), now, { force: true });
    expect(getCandlesApi.mock.calls[0][1]).toBe(1300);
    expect(saveHistoryStats).toHaveBeenCalledTimes(2);
    expect(saveHistoryStats.mock.calls[0][0]).toBe(symbols[0]);
  });
});

describe("recalculateEverything", () => {
  it("does every batch in one call, a minute apart", async () => {
    vi.useFakeTimers();
    try {
      const { recalculateEverything } = await import("./recalculateSupports");
      const { listSymbols } = await import("@/lib/db/symbols");
      vi.mocked(listSymbols).mockResolvedValue(symbols);
      const bars = Array.from({ length: 60 }, (_, i) => ({
        date: new Date(Date.UTC(2026, 6, 1 + i)).toISOString().slice(0, 10),
        open: 100, high: 102 + (i % 3), low: 98 - (i % 2), close: 100 + (i % 5), volume: 1,
      }));
      getCandlesApi.mockImplementation(async (batch: string[]) => ({ data: Object.fromEntries(batch.map((s) => [s, bars])), errors: {} }));
      const done = recalculateEverything(now, { force: true });
      await vi.advanceTimersByTimeAsync(5 * 61_000);
      const r = await done;
      expect(getCandlesApi.mock.calls.map(([s]) => (s as string[]).length)).toEqual([8, 8, 4]);
      expect(r.updated).toHaveLength(20);
      expect(r.remaining).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
