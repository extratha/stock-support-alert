import { beforeEach, describe, expect, it, vi } from "vitest";

const saveFundamentals = vi.fn(async () => {});
const symbolsNeedingFundamentals = vi.fn();
const fetchFundamentals = vi.fn();
vi.mock("@/lib/db/profiles", () => ({ saveFundamentals, symbolsNeedingFundamentals }));
vi.mock("@/lib/profile/finnhub", () => ({ fetchFundamentals }));

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
});
