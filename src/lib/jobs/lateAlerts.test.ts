import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LateItem } from "@/lib/alerts/format";

const claimAlert = vi.fn(async () => true);
const releaseAlert = vi.fn(async () => {});
const recordAlerts = vi.fn(async () => {});
const loadStates = vi.fn(async () => new Map());
vi.mock("@/lib/db/alerts", () => ({ claimAlert, releaseAlert, recordAlerts, loadStates, rearm: vi.fn(), stateKey: (s: string, t: string) => `${s}:${t}` }));
const notify = vi.fn(async () => ({ sent: 1 }));
const recipients = vi.fn(async () => ["U1"]);
vi.mock("./notify", () => ({ notify, recipients }));

const { deliverLateAlerts } = await import("./checkAlerts");

const item = (over: Partial<LateItem>): LateItem => ({
  symbol: "NVDA", tier: "major", method: "ma200", level: 100, zoneLow: null, date: "2026-09-29", low: 99, close: 101,
  missedTouch: true, broke: false, next: null, ...over,
});

describe("deliverLateAlerts", () => {
  beforeEach(() => vi.clearAllMocks());

  it("claims a missed touch, sends one message and records it", async () => {
    expect(await deliverLateAlerts([item({})])).toEqual(["NVDA:major:touch"]);
    expect(claimAlert).toHaveBeenCalledWith("NVDA", "major");
    expect(notify).toHaveBeenCalledTimes(1);
    expect(recordAlerts).toHaveBeenCalledWith([{ symbol: "NVDA", tier: "major", method: "ma200", price: 101, level: 100 }]);
  });

  it("drops a touch someone else already alerted, but still reports a break", async () => {
    claimAlert.mockResolvedValue(false);
    expect(await deliverLateAlerts([item({})])).toEqual([]);
    expect(await deliverLateAlerts([item({ broke: true, close: 95 })])).toEqual(["NVDA:major:break"]);
    expect(recordAlerts).toHaveBeenLastCalledWith([]);
    claimAlert.mockResolvedValue(true);
  });

  it("gives the claim back when nobody can receive it or the push fails", async () => {
    recipients.mockResolvedValueOnce([]);
    expect(await deliverLateAlerts([item({})])).toEqual([]);
    expect(releaseAlert).toHaveBeenCalledTimes(1);
    notify.mockRejectedValueOnce(new Error("quota"));
    await expect(deliverLateAlerts([item({})])).rejects.toThrow("quota");
    expect(releaseAlert).toHaveBeenCalledTimes(2);
  });
});
