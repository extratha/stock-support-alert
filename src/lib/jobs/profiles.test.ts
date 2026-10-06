import { beforeEach, describe, expect, it, vi } from "vitest";

const saveFundamentals = vi.fn(async () => {});
const symbolsNeedingFundamentals = vi.fn();
const saveAnalysts = vi.fn(async () => {});
const symbolsNeedingAnalysts = vi.fn(async (symbols: string[]) => new Set<string>(symbols));
const fetchFundamentals = vi.fn();
const fetchAnalysts = vi.fn<(symbol: string) => Promise<{ recBuy: number }>>(async () => ({ recBuy: 3 }));
vi.mock("@/lib/db/profiles", () => ({ saveFundamentals, symbolsNeedingFundamentals, saveAnalysts, symbolsNeedingAnalysts }));
vi.mock("@/lib/profile/finnhub", () => ({ fetchFundamentals, fetchAnalysts }));

const f = { pe: 20, forwardPe: 18, revenueGrowth: 10, netMargin: 15, beta: 1.1, dividendYield: null, nextEarnings: null, earningsHour: null };

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("FINNHUB_API_KEY", "k");
});

describe("refreshFundamentals", () => {
  it("refreshes only stale symbols (older than ~20 h), up to the limit, and stores them", async () => {
    symbolsNeedingFundamentals.mockResolvedValue(["AMD", "NVDA"]);
    fetchFundamentals.mockResolvedValue(f);
    const { refreshFundamentals } = await import("./profiles");
    const r = await refreshFundamentals({ now: new Date("2026-09-30T22:00:00Z") });
    expect(symbolsNeedingFundamentals).toHaveBeenCalledWith(20, 20);
    expect(r.updated.sort()).toEqual(["AMD", "NVDA"]);
    expect(saveFundamentals).toHaveBeenCalledTimes(2);
    expect(fetchFundamentals.mock.calls[0][2]).toBe("2026-09-30"); // New York date
  });

  it("keeps going when one symbol fails, and never throws", async () => {
    symbolsNeedingFundamentals.mockResolvedValue(["AMD", "BAD"]);
    fetchFundamentals.mockImplementation(async (s: string) => {
      if (s === "BAD") throw new Error("HTTP 429");
      return f;
    });
    const { refreshFundamentals } = await import("./profiles");
    const r = await refreshFundamentals();
    expect(r.updated).toEqual(["AMD"]);
    expect(r.errors).toEqual({ BAD: "HTTP 429" });
  });

  it("does nothing without a Finnhub key", async () => {
    vi.stubEnv("FINNHUB_API_KEY", "");
    const { refreshFundamentals } = await import("./profiles");
    const r = await refreshFundamentals();
    expect(r.updated).toEqual([]);
    expect(fetchFundamentals).not.toHaveBeenCalled();
  });

  it("an explicit symbol list (adding a stock) skips the staleness query", async () => {
    fetchFundamentals.mockResolvedValue(f);
    const { refreshFundamentals } = await import("./profiles");
    await refreshFundamentals({ symbols: ["KO"] });
    expect(symbolsNeedingFundamentals).not.toHaveBeenCalled();
    expect(saveFundamentals).toHaveBeenCalledWith("KO", f);
  });

  it("refreshes analyst views only for symbols whose views are stale (every few days), and their failure never fails a symbol", async () => {
    symbolsNeedingFundamentals.mockResolvedValue(["AMD", "NVDA", "MU"]);
    symbolsNeedingAnalysts.mockResolvedValueOnce(new Set(["NVDA", "MU"]));
    fetchFundamentals.mockResolvedValue(f);
    fetchAnalysts.mockImplementation(async (s: string) => {
      if (s === "MU") throw new Error("HTTP 429");
      return { recBuy: 3 };
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { refreshFundamentals } = await import("./profiles");
    const r = await refreshFundamentals({ now: new Date("2026-09-30T22:00:00Z") });
    expect(symbolsNeedingAnalysts).toHaveBeenCalledWith(["AMD", "NVDA", "MU"], 72);
    expect(fetchAnalysts.mock.calls.map((c) => c[0]).sort()).toEqual(["MU", "NVDA"]);
    expect(saveAnalysts).toHaveBeenCalledTimes(1);
    expect(r.updated.sort()).toEqual(["AMD", "MU", "NVDA"]);
    expect(r.errors).toEqual({});
  });
});
