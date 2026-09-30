import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchLivePrice, fetchLivePrices, parseFinnhubQuote, parseYahooChart } from "./live";

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

  it("returns within the overall deadline even if every source hangs, reporting the unfinished symbols", async () => {
    // A fetch that never answers on its own: it only ends when the AbortSignal it was given fires.
    fetchMock.mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => init.signal?.addEventListener("abort", () => reject(new Error("aborted")))),
    );
    const started = Date.now();
    const symbols = Array.from({ length: 25 }, (_, i) => `S${i}`);
    const r = await fetchLivePrices(symbols, { deadlineMs: 150 });
    expect(Date.now() - started).toBeLessThan(2000); // nowhere near "hang forever"
    expect(Object.keys(r.prices)).toHaveLength(0);
    expect(Object.keys(r.errors).sort()).toEqual([...symbols].sort());
    expect(Object.values(r.errors).some((e) => e.includes("deadline"))).toBe(true);
  });

  it("keeps what finished before the deadline and does not start new symbols after it", async () => {
    fetchMock.mockImplementation((url: string, init: RequestInit) => {
      const fast = String(url).includes("symbol=FAST");
      if (fast) return Promise.resolve(finnhubOk(42));
      return new Promise((_r, reject) => init.signal?.addEventListener("abort", () => reject(new Error("aborted"))));
    });
    const r = await fetchLivePrices(["FAST", "SLOW"], { deadlineMs: 150 });
    expect(r.prices.FAST).toMatchObject({ price: 42, source: "finnhub" });
    expect(r.errors.SLOW).toBeDefined();
    expect(r.prices.SLOW).toBeUndefined();
  });

  it("moves on to the next source when one is slow: Finnhub times out, Yahoo answers", async () => {
    fetchMock.mockImplementation((url: string, init: RequestInit) => {
      if (String(url).includes("finnhub")) {
        return new Promise((_r, reject) => init.signal?.addEventListener("abort", () => reject(new Error("timed out"))));
      }
      return Promise.resolve(yahooOk(77));
    });
    const started = Date.now();
    const r = await fetchLivePrice("NVDA");
    expect(r.price).toMatchObject({ price: 77, source: "yahoo" });
    expect(Date.now() - started).toBeLessThan(6000); // SOURCE_TIMEOUT_MS (4 s) + a little, never unbounded
  }, 10_000);
});

