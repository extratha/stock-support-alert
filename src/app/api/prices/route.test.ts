import { beforeEach, describe, expect, it, vi } from "vitest";

const listSymbols = vi.fn();
const listCachedQuotes = vi.fn();
const fetchLivePrices = vi.fn();
vi.mock("@/lib/db/symbols", () => ({ listSymbols }));
vi.mock("@/lib/db/quotes", () => ({ listCachedQuotes }));
vi.mock("@/lib/stock/live", () => ({ fetchLivePrices }));

const cachedAt = new Date("2026-09-29T13:30:00Z");

beforeEach(() => {
  vi.clearAllMocks();
  listSymbols.mockResolvedValue(["NVDA", "AMD", "TSM"]);
  listCachedQuotes.mockResolvedValue([
    { symbol: "NVDA", price: 200, quoteTime: cachedAt, fetchedAt: cachedAt },
    { symbol: "AMD", price: 600, quoteTime: cachedAt, fetchedAt: cachedAt },
  ]);
});

const get = async () => {
  const { GET } = await import("./route");
  return (await (await GET()).json()) as { prices: Record<string, unknown>; errors: Record<string, string> };
};

describe("GET /api/prices", () => {
  it("prefers live prices, falls back to the price stored by the cron check, and omits symbols with neither", async () => {
    fetchLivePrices.mockResolvedValue({
      prices: { NVDA: { symbol: "NVDA", price: 227.21, previousClose: null, asOf: "2026-09-29T20:00:00.000Z", source: "finnhub" } },
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
    fetchLivePrices.mockResolvedValue({ prices: {}, errors: {} });
    await get();
    expect(fetchLivePrices).toHaveBeenCalledWith(["NVDA", "AMD", "TSM"]);
  });

  it("still answers from the stored prices when the DB quote cache read fails", async () => {
    listCachedQuotes.mockRejectedValue(new Error("db"));
    fetchLivePrices.mockResolvedValue({
      prices: { AMD: { symbol: "AMD", price: 607.57, previousClose: null, asOf: null, source: "yahoo" } },
      errors: {},
    });
    expect((await get()).prices).toEqual({ AMD: { price: 607.57, asOf: null, source: "yahoo" } });
  });
});
