import { beforeEach, describe, expect, it, vi } from "vitest";

const listLiveQuotes = vi.fn();
const upsertLiveQuotes = vi.fn(async () => {});
const fetchLivePrices = vi.fn();
vi.mock("@/lib/db/liveQuotes", () => ({ listLiveQuotes, upsertLiveQuotes }));
vi.mock("@/lib/stock/live", () => ({ fetchLivePrices }));

const NOW = 1_800_000_000_000;
const stored = (symbol: string, price: number, ageSeconds: number, source = "finnhub") => ({
  symbol,
  price,
  previousClose: null,
  asOf: "2026-09-29T20:00:00.000Z",
  source,
  fetchedAt: new Date(NOW - ageSeconds * 1000),
});
const live = (symbol: string, price: number) => ({ symbol, price, previousClose: null, asOf: "2026-09-30T01:00:00.000Z", source: "finnhub" as const });

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  listLiveQuotes.mockResolvedValue([]);
});

const run = async (symbols: string[], opts: { force?: boolean } = {}) => {
  const { getLivePrices } = await import("./livePrices");
  return getLivePrices(symbols, { ...opts, now: NOW });
};

describe("getLivePrices shared cache", () => {
  it("serves prices fetched within 5 minutes from the DB without calling any API", async () => {
    listLiveQuotes.mockResolvedValue([stored("NVDA", 200, 299), stored("AMD", 600, 10)]);
    const r = await run(["NVDA", "AMD"]);
    expect(fetchLivePrices).not.toHaveBeenCalled();
    expect(r.prices.NVDA).toMatchObject({ price: 200, source: "finnhub" });
    expect(r.prices.AMD.price).toBe(600);
  });

  it("refetches only the symbols whose cached price is older than the TTL, and stores the result", async () => {
    listLiveQuotes.mockResolvedValue([stored("NVDA", 200, 10), stored("AMD", 600, 301)]);
    fetchLivePrices.mockResolvedValue({ prices: { AMD: live("AMD", 610) }, errors: {} });
    const r = await run(["NVDA", "AMD", "TSM"]);
    expect(fetchLivePrices).toHaveBeenCalledTimes(1);
    expect((fetchLivePrices.mock.calls[0] as unknown as [string[]])[0].sort()).toEqual(["AMD", "TSM"]);
    expect(upsertLiveQuotes).toHaveBeenCalledWith([expect.objectContaining({ symbol: "AMD", price: 610 })]);
    expect(r.prices.NVDA.price).toBe(200);
    expect(r.prices.AMD.price).toBe(610);
  });

  it("honours LIVE_PRICE_TTL_SECONDS", async () => {
    vi.stubEnv("LIVE_PRICE_TTL_SECONDS", "60");
    listLiveQuotes.mockResolvedValue([stored("NVDA", 200, 61)]);
    fetchLivePrices.mockResolvedValue({ prices: { NVDA: live("NVDA", 201) }, errors: {} });
    await run(["NVDA"]);
    expect(fetchLivePrices).toHaveBeenCalledTimes(1);
  });

  it("the refresh button (force) skips the 5-minute cache but never refetches within 30 seconds", async () => {
    listLiveQuotes.mockResolvedValue([stored("NVDA", 200, 100), stored("AMD", 600, 5)]);
    fetchLivePrices.mockResolvedValue({ prices: { NVDA: live("NVDA", 205) }, errors: {} });
    const r = await run(["NVDA", "AMD"], { force: true });
    expect((fetchLivePrices.mock.calls[0] as unknown as [string[]])[0]).toEqual(["NVDA"]); // AMD is only 5 s old
    expect(r.prices.NVDA.price).toBe(205);
    expect(r.prices.AMD.price).toBe(600);
  });

  it("keeps the last known live price, marked stale, when a refetch fails", async () => {
    listLiveQuotes.mockResolvedValue([stored("NVDA", 200, 900)]);
    fetchLivePrices.mockResolvedValue({ prices: {}, errors: { NVDA: "finnhub: HTTP 429; yahoo: HTTP 429" } });
    const r = await run(["NVDA"]);
    expect(r.prices.NVDA).toMatchObject({ price: 200, stale: true });
    expect(r.errors.NVDA).toContain("429");
    expect(upsertLiveQuotes).not.toHaveBeenCalled();
  });

  it("leaves a symbol out (the route then uses the Twelve Data price) when it has neither a fresh nor an old price", async () => {
    fetchLivePrices.mockResolvedValue({ prices: {}, errors: { TSM: "deadline reached" } });
    const r = await run(["TSM"]);
    expect(r.prices.TSM).toBeUndefined();
    expect(r.errors.TSM).toBeDefined();
  });

  it("still answers when the DB cache cannot be read or written", async () => {
    listLiveQuotes.mockRejectedValue(new Error("db"));
    upsertLiveQuotes.mockRejectedValueOnce(new Error("db write"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    fetchLivePrices.mockResolvedValue({ prices: { NVDA: live("NVDA", 210) }, errors: {} });
    const r = await run(["NVDA"]);
    expect(r.prices.NVDA.price).toBe(210);
  });

  it("passes the configured overall deadline to the fetcher", async () => {
    vi.stubEnv("LIVE_PRICE_DEADLINE_MS", "9000");
    fetchLivePrices.mockResolvedValue({ prices: {}, errors: {} });
    await run(["NVDA"]);
    expect(fetchLivePrices).toHaveBeenCalledWith(["NVDA"], { deadlineMs: 9000 });
  });

  it("shares one outbound fetch between simultaneous requests for the same symbols", async () => {
    let release!: (v: unknown) => void;
    fetchLivePrices.mockImplementation(() => new Promise((r) => (release = r)));
    const [a, b] = [run(["NVDA"]), run(["NVDA"])];
    await new Promise((r) => setTimeout(r, 20));
    release({ prices: { NVDA: live("NVDA", 215) }, errors: {} });
    const [ra, rb] = await Promise.all([a, b]);
    expect(fetchLivePrices).toHaveBeenCalledTimes(1);
    expect(ra.prices.NVDA.price).toBe(215);
    expect(rb.prices.NVDA.price).toBe(215);
  });
});
