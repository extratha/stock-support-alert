import { beforeEach, describe, expect, it, vi } from "vitest";

const listSymbols = vi.fn();
const listCachedQuotes = vi.fn();
const getLivePrices = vi.fn();
vi.mock("@/lib/db/symbols", () => ({ listSymbols }));
vi.mock("@/lib/db/quotes", () => ({ listCachedQuotes }));
vi.mock("@/lib/jobs/livePrices", () => ({ getLivePrices }));

const cachedAt = new Date("2026-09-29T13:30:00Z");

beforeEach(() => {
  vi.clearAllMocks();
  listSymbols.mockResolvedValue(["NVDA", "AMD", "TSM"]);
  listCachedQuotes.mockResolvedValue([
    { symbol: "NVDA", price: 200, quoteTime: cachedAt, fetchedAt: cachedAt },
    { symbol: "AMD", price: 600, quoteTime: cachedAt, fetchedAt: cachedAt },
  ]);
});

const get = async (query = "") => {
  const { GET } = await import("./route");
  const res = await GET(new Request(`http://x/api/prices${query}`));
  return { status: res.status, ...((await res.json()) as { prices: Record<string, unknown>; errors: Record<string, string>; error?: string }) };
};

describe("GET /api/prices", () => {
  it("prefers live prices, falls back to the price stored by the cron check, and omits symbols with neither", async () => {
    getLivePrices.mockResolvedValue({
      prices: { NVDA: { price: 227.21, asOf: "2026-09-29T20:00:00.000Z", source: "finnhub" } },
      errors: { AMD: "finnhub: HTTP 500; yahoo: HTTP 429", TSM: "finnhub: no quote; yahoo: HTTP 404" },
    });
    const body = await get();
    expect(body.prices).toEqual({
      NVDA: { price: 227.21, asOf: "2026-09-29T20:00:00.000Z", source: "finnhub" },
      AMD: { price: 600, asOf: cachedAt.toISOString(), source: "db" },
    });
    expect(Object.keys(body.errors)).toEqual(["AMD", "TSM"]);
  });

  it("only ever asks about the tracked symbols (nothing user-supplied)", async () => {
    getLivePrices.mockResolvedValue({ prices: {}, errors: {} });
    await get();
    expect(getLivePrices).toHaveBeenCalledWith(["NVDA", "AMD", "TSM"], { force: false });
  });

  it("still answers from the stored prices when the DB quote cache read fails", async () => {
    listCachedQuotes.mockRejectedValue(new Error("db"));
    getLivePrices.mockResolvedValue({ prices: { AMD: { price: 607.57, asOf: null, source: "yahoo" } }, errors: {} });
    expect((await get()).prices).toEqual({ AMD: { price: 607.57, asOf: null, source: "yahoo" } });
  });

  it("?force=1 (the refresh button) is passed on to the cache layer", async () => {
    getLivePrices.mockResolvedValue({ prices: {}, errors: {} });
    await get("?force=1");
    expect(getLivePrices).toHaveBeenCalledWith(["NVDA", "AMD", "TSM"], { force: true });
  });

  it("keeps an older live price marked stale instead of dropping to the Twelve Data price", async () => {
    getLivePrices.mockResolvedValue({
      prices: { AMD: { price: 605, asOf: "2026-09-29T20:00:00.000Z", source: "finnhub", stale: true } },
      errors: { AMD: "finnhub: HTTP 429" },
    });
    expect((await get()).prices.AMD).toMatchObject({ price: 605, stale: true });
  });

  it("answers 503 (not a hang) when the symbol list itself cannot be loaded", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    listSymbols.mockRejectedValue(new Error("db down"));
    const r = await get();
    expect(r.status).toBe(503);
    expect(r.error).toBeDefined();
  });
});
