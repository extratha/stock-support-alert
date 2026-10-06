import { beforeEach, describe, expect, it, vi } from "vitest";

const scheduled: (() => Promise<void>)[] = [];
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: (fn: () => Promise<void>) => scheduled.push(fn) }));
const checkAlerts = vi.fn(async () => ({ checked: 3, alerts: ["NVDA:major"] }));
vi.mock("@/lib/jobs/checkAlerts", () => ({ checkAlerts }));
const recalculateEverything = vi.fn(async () => ({ updated: ["NVDA"], remaining: 0 }));
const recalculateAll = vi.fn(async () => ({ updated: ["NVDA"], remaining: 0 }));
vi.mock("@/lib/jobs/recalculateSupports", () => ({ recalculateAll, recalculateEverything }));
vi.mock("@/lib/jobs/logos", () => ({ backfillLogos: vi.fn(async () => null) }));
vi.mock("@/lib/jobs/profiles", () => ({ refreshFundamentals: vi.fn(async () => null) }));

const check = await import("./check/route");
const recalc = await import("./recalculate/route");
const req = (path: string, auth = "Bearer s3cret") => new Request(`http://x${path}`, { method: "POST", headers: { authorization: auth } });

describe("cron routes for an outside scheduler (?async=1)", () => {
  beforeEach(() => {
    scheduled.length = 0;
    vi.clearAllMocks();
    vi.stubEnv("CRON_SECRET", "s3cret");
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("check: answers 202 at once and runs the whole check afterwards", async () => {
    const res = await check.POST(req("/api/cron/check?mode=daily&async=1"));
    expect(res.status).toBe(202);
    expect(checkAlerts).not.toHaveBeenCalled();
    await scheduled[0]();
    expect(checkAlerts).toHaveBeenCalledWith(expect.any(Date), { force: false, mode: "daily" });
  });

  it("recalculate: answers 202 and does every batch afterwards", async () => {
    const res = await recalc.POST(req("/api/cron/recalculate?async=1"));
    expect(res.status).toBe(202);
    await scheduled[0]();
    expect(recalculateEverything).toHaveBeenCalledWith(expect.any(Date), { force: false });
    expect(recalculateAll).not.toHaveBeenCalled();
  });

  it("a failure in the background is logged, not thrown", async () => {
    checkAlerts.mockRejectedValueOnce(new Error("boom"));
    await check.POST(req("/api/cron/check?async=1"));
    await expect(scheduled[0]()).resolves.toBeUndefined();
  });

  it("without async the old behaviour stays (the GitHub workflows still use it), and the secret is still required", async () => {
    expect(await (await check.POST(req("/api/cron/check?mode=daily"))).json()).toEqual({ checked: 3, alerts: ["NVDA:major"] });
    expect(scheduled).toHaveLength(0);
    expect((await check.POST(req("/api/cron/check?async=1", "Bearer wrong"))).status).toBe(401);
    expect((await recalc.POST(req("/api/cron/recalculate?async=1", ""))).status).toBe(401);
    expect(scheduled).toHaveLength(0);
  });
});
