import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearLiveCache, fetchLivePrice, fetchLivePrices, LIVE_CACHE_TTL_MS, parseFinnhubQuote, parseYahooChart } from "./live";

describe("parseFinnhubQuote", () => {
  it("reads current price, previous close and last-trade time", () => {
    expect(parseFinnhubQuote("NVDA", { c: 227.21, pc: 228.86, t: 1790712000 })).toEqual({
      symbol: "NVDA",
      price: 227.21,
      previousClose: 228.86,
      asOf: "2026-09-29T20:00:00.000Z",
      source: "finnhub",
    });
  });
  it("treats Finnhub's all-zero answer for unknown symbols as no quote", () => {
    expect(parseFinnhubQuote("ZZZZ", { c: 0, d: null, dp: null, h: 0, l: 0, o: 0, pc: 0, t: 0 })).toBeNull();
    expect(parseFinnhubQuote("X", {})).toBeNull();
  });
});

describe("parseYahooChart", () => {
  it("reads meta.regularMarketPrice", () => {
    const json = { chart: { result: [{ meta: { regularMarketPrice: 227.21, chartPreviousClose: 228.86, regularMarketTime: 1790712000 } }] } };
    expect(parseYahooChart("NVDA", json)).toMatchObject({ price: 227.21, previousClose: 228.86, source: "yahoo" });
  });
  it("returns null for errors / empty results", () => {
    expect(parseYahooChart("X", { chart: { result: null, error: { code: "Not Found" } } })).toBeNull();
    expect(parseYahooChart("X", {})).toBeNull();
  });
});

const finnhubOk = (c: number) => new Response(JSON.stringify({ c, pc: c - 1, t: 1790712000 }));
const yahooOk = (p: number) => new Response(JSON.stringify({ chart: { result: [{ meta: { regularMarketPrice: p } }] } }));
const fail = (status = 500) => new Response("x", { status });

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  clearLiveCache();
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("FINNHUB_API_KEY", "test-key");
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("fetchLivePrice (Finnhub -> Yahoo)", () => {
  it("uses Finnhub when it works, sending the key in a header (not the URL)", async () => {
    fetchMock.mockResolvedValueOnce(finnhubOk(100));
    const r = await fetchLivePrice("NVDA");
    expect(r.price).toMatchObject({ price: 100, source: "finnhub" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).not.toContain("test-key");
    expect((init.headers as Record<string, string>)["X-Finnhub-Token"]).toBe("test-key");
  });

  it("falls back to Yahoo when Finnhub fails or has no quote", async () => {
    fetchMock.mockResolvedValueOnce(fail(429)).mockResolvedValueOnce(yahooOk(99));
    expect((await fetchLivePrice("NVDA")).price).toMatchObject({ price: 99, source: "yahoo" });

    fetchMock.mockReset();
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ c: 0, t: 0 }))).mockResolvedValueOnce(yahooOk(98));
    expect((await fetchLivePrice("NVDA")).price).toMatchObject({ price: 98, source: "yahoo" });
  });

  it("skips Finnhub entirely when no key is configured", async () => {
    vi.stubEnv("FINNHUB_API_KEY", "");
    fetchMock.mockResolvedValueOnce(yahooOk(97));
    expect((await fetchLivePrice("NVDA")).price).toMatchObject({ price: 97, source: "yahoo" });
    expect(String(fetchMock.mock.calls[0][0])).toContain("yahoo");
  });

  it("reports what each source said when both fail, without throwing", async () => {
    fetchMock.mockResolvedValueOnce(fail(500)).mockRejectedValueOnce(new Error("timeout"));
    const r = await fetchLivePrice("NVDA");
    expect(r.price).toBeUndefined();
    expect(r.error).toContain("finnhub: HTTP 500");
    expect(r.error).toContain("yahoo: timeout");
  });
});

describe("fetchLivePrices", () => {
  it("returns good symbols and lists only the failed ones in errors", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).includes("finnhub")) return String(url).includes("BAD") ? fail(404) : finnhubOk(10);
      return fail(404); // Yahoo has nothing either for BAD
    });
    const r = await fetchLivePrices(["AAA", "BAD", "CCC"]);
    expect(Object.keys(r.prices).sort()).toEqual(["AAA", "CCC"]);
    expect(Object.keys(r.errors)).toEqual(["BAD"]);
  });

  it("caches for 30s so repeated refreshes don't call the APIs again", async () => {
    fetchMock.mockImplementation(async () => finnhubOk(10)); // a Response body can only be read once
    await fetchLivePrices(["AAA", "BBB"], 1_000_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await fetchLivePrices(["AAA", "BBB"], 1_000_000 + LIVE_CACHE_TTL_MS - 1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await fetchLivePrices(["AAA", "BBB"], 1_000_000 + LIVE_CACHE_TTL_MS + 1);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("does not cache failures", async () => {
    fetchMock.mockImplementation(async () => fail(500));
    await fetchLivePrices(["AAA"], 5);
    const calls = fetchMock.mock.calls.length;
    await fetchLivePrices(["AAA"], 6);
    expect(fetchMock.mock.calls.length).toBeGreaterThan(calls);
  });
});
