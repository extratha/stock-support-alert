import { beforeEach, describe, expect, it, vi } from "vitest";

const lastRunDay = vi.fn<(job: string) => Promise<string | null>>(async () => null);
const markRun = vi.fn(async () => {});
vi.mock("@/lib/db/jobRuns", () => ({ lastRunDay, markRun }));
vi.mock("@/lib/db/symbols", () => ({ listSymbols: vi.fn(async () => ["NVDA"]) }));
vi.mock("@/lib/db/supports", () => ({ listSupports: vi.fn(async () => []) }));
vi.mock("@/lib/db/alerts", () => ({
  loadStates: vi.fn(async () => new Map()), claimAlert: vi.fn(), releaseAlert: vi.fn(), recordAlerts: vi.fn(), rearm: vi.fn(),
  stateKey: (s: string, t: string) => `${s}:${t}`,
}));
const getQuotes = vi.fn(async () => ({ prices: { NVDA: 180 } as Record<string, number>, lows: {}, prevCloses: {}, errors: {} as Record<string, string>, fetched: 1, cached: 0, remaining: 0 }));
const warmQuotes = vi.fn(async () => {});
vi.mock("./quotes", () => ({ getQuotes, warmQuotes }));
vi.mock("./notify", () => ({ notify: vi.fn(), recipients: vi.fn(async () => ["U1"]) }));

const { checkAlerts, skipReason } = await import("./checkAlerts");

// Wednesday 30 Sep 2026, New York is on EDT (UTC-4): 13:30 ET = 17:30 UTC
const at = (utc: string) => new Date(`2026-09-30T${utc}:00Z`);

describe("once-a-day check", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lastRunDay.mockResolvedValue(null);
  });

  it("two checks, 10:30 and 13:30 ET, each accepted until the next one (late GitHub schedules still count)", async () => {
    const { dailyCheckSlot } = await import("./checkAlerts");
    expect(await skipReason(at("14:29"), { mode: "daily" })).toBe("outside_daily_window"); // 10:29 EDT
    expect(dailyCheckSlot(at("14:30"))).toBe("daily-check-1030");
    expect(dailyCheckSlot(at("17:29"))).toBe("daily-check-1030"); // 3 h late, still the morning check
    expect(dailyCheckSlot(at("17:30"))).toBe("daily-check-1330");
    expect(dailyCheckSlot(at("19:59"))).toBe("daily-check-1330");
    expect(await skipReason(at("20:00"), { mode: "daily" })).toBe("market_closed");
  });

  it("each check records its own run; the other UTC candidate of the same check then does nothing", async () => {
    await checkAlerts(at("14:40"), { mode: "daily" });
    expect(markRun).toHaveBeenCalledWith("daily-check-1030", "2026-09-30");
    lastRunDay.mockImplementation(async (job) => (job === "daily-check-1030" ? "2026-09-30" : null));
    expect((await checkAlerts(at("15:35"), { mode: "daily" })).skipped).toBe("already_checked_today");
    expect((await checkAlerts(at("17:40"), { mode: "daily" })).skipped).toBeUndefined(); // the 13:30 check still runs
    expect(markRun).toHaveBeenLastCalledWith("daily-check-1330", "2026-09-30");
  });

  it("a run with quote errors is not recorded, so the next candidate tries again", async () => {
    getQuotes.mockResolvedValueOnce({ prices: {}, lows: {}, prevCloses: {}, errors: { NVDA: "HTTP 500" }, fetched: 0, cached: 0, remaining: 0 });
    await checkAlerts(at("17:40"), { mode: "daily" });
    expect(markRun).not.toHaveBeenCalled();
  });

  it("still checks when the bookkeeping table is unavailable; forced and intraday runs ignore it", async () => {
    lastRunDay.mockRejectedValue(new Error("relation job_runs does not exist"));
    expect(await skipReason(at("17:40"), { mode: "daily" })).toBeUndefined();
    lastRunDay.mockResolvedValue("2026-09-30");
    expect(await skipReason(at("17:40"), { mode: "daily", force: true })).toBeUndefined();
    expect(await skipReason(at("17:40"), { mode: "intraday" })).toBeUndefined();
    await checkAlerts(at("17:40"), { mode: "daily", force: true });
    expect(markRun).not.toHaveBeenCalled();
  });

  it("fetches every quote first (in batches), then checks", async () => {
    await checkAlerts(at("17:40"), { mode: "daily" });
    expect(warmQuotes).toHaveBeenCalledWith(["NVDA"], 200_000);
    expect(warmQuotes.mock.invocationCallOrder[0]).toBeLessThan(getQuotes.mock.invocationCallOrder[0]);
  });
});
