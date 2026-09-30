import { describe, expect, it } from "vitest";
import { isMarketOpen, isTradingDay, isWithinWindowAfterOpen, lastCompletedSession, sessionCloseMinutes } from "./calendar";

const at = (iso: string) => new Date(iso);

describe("isTradingDay", () => {
  it("knows the 2026 NYSE holidays", () => {
    for (const d of [
      "2026-01-01", "2026-01-19", "2026-02-16", "2026-04-03", "2026-05-25",
      "2026-06-19", "2026-07-03", "2026-09-07", "2026-11-26", "2026-12-25",
    ]) {
      expect(isTradingDay(d), d).toBe(false);
    }
  });
  it("is open on ordinary weekdays and closed on weekends", () => {
    expect(isTradingDay("2026-09-30")).toBe(true);
    expect(isTradingDay("2026-10-03")).toBe(false);
  });
  it("does not observe a Saturday New Year on the prior Friday", () => {
    expect(isTradingDay("2021-12-31")).toBe(true); // Jan 1 2022 was a Saturday
  });
});

describe("isMarketOpen (DST aware)", () => {
  it("summer (EDT): 9:30 ET = 13:30 UTC", () => {
    expect(isMarketOpen(at("2026-07-15T13:29:00Z"))).toBe(false);
    expect(isMarketOpen(at("2026-07-15T13:30:00Z"))).toBe(true);
    expect(isMarketOpen(at("2026-07-15T19:59:00Z"))).toBe(true);
    expect(isMarketOpen(at("2026-07-15T20:00:00Z"))).toBe(false);
  });
  it("winter (EST): 9:30 ET = 14:30 UTC", () => {
    expect(isMarketOpen(at("2026-01-14T14:29:00Z"))).toBe(false);
    expect(isMarketOpen(at("2026-01-14T14:30:00Z"))).toBe(true);
    expect(isMarketOpen(at("2026-01-14T20:59:00Z"))).toBe(true);
    expect(isMarketOpen(at("2026-01-14T21:00:00Z"))).toBe(false);
  });
  it("closed on holidays and weekends", () => {
    expect(isMarketOpen(at("2026-07-03T15:00:00Z"))).toBe(false);
    expect(isMarketOpen(at("2026-07-18T15:00:00Z"))).toBe(false);
  });
  it("closes at 13:00 ET on early-close days", () => {
    expect(sessionCloseMinutes("2026-11-27")).toBe(13 * 60);
    expect(isMarketOpen(at("2026-11-27T17:59:00Z"))).toBe(true); // 12:59 EST
    expect(isMarketOpen(at("2026-11-27T18:00:00Z"))).toBe(false);
  });
});

describe("lastCompletedSession", () => {
  it("is the same day once the close has settled", () => {
    expect(lastCompletedSession(at("2026-09-30T20:30:00Z"))).toBe("2026-09-30"); // 16:30 EDT
  });
  it("is the previous trading day during the session", () => {
    expect(lastCompletedSession(at("2026-09-30T15:00:00Z"))).toBe("2026-09-29");
  });
  it("skips weekends and holidays", () => {
    expect(lastCompletedSession(at("2026-09-08T13:00:00Z"))).toBe("2026-09-04"); // Tue after Labor Day, pre-market
    expect(lastCompletedSession(at("2026-10-04T15:00:00Z"))).toBe("2026-10-02"); // Sunday
  });
});

describe("isWithinWindowAfterOpen (daily run, 4h after open)", () => {
  const w = (iso: string) => isWithinWindowAfterOpen(at(iso), 240, 50);
  it("summer (EDT): only the 17:30 UTC candidate lands in the window", () => {
    expect(w("2026-07-15T17:30:00Z")).toBe(true); // 13:30 EDT
    expect(w("2026-07-15T18:30:00Z")).toBe(false); // 14:30 EDT
  });
  it("winter (EST): only the 18:30 UTC candidate lands in the window", () => {
    expect(w("2026-01-14T17:30:00Z")).toBe(false); // 12:30 EST
    expect(w("2026-01-14T18:30:00Z")).toBe(true); // 13:30 EST
  });
  it("tolerates a delayed cron but not beyond the window", () => {
    expect(w("2026-07-15T18:10:00Z")).toBe(true); // 14:10 EDT
    expect(w("2026-07-15T18:20:00Z")).toBe(false); // 14:20 EDT
  });
  it("is false on holidays", () => {
    expect(w("2026-07-03T17:30:00Z")).toBe(false);
  });
});
