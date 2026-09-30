import { describe, expect, it } from "vitest";
import { evaluateTier } from "./evaluate";

const now = new Date("2026-09-30T15:00:00Z");
const minutesAgo = (m: number) => new Date(now.getTime() - m * 60_000);

describe("evaluateTier", () => {
  const level = 100;

  it("does nothing while price is well above the level", () => {
    expect(evaluateTier({ price: 105, level, state: undefined, now })).toBe("none");
  });

  it("alerts on first touch (within tolerance, or through the level)", () => {
    expect(evaluateTier({ price: 100.2, level, state: undefined, now })).toBe("alert");
    expect(evaluateTier({ price: 97, level, state: undefined, now })).toBe("alert");
  });

  it("stays quiet while disarmed and price hovers near/below the level", () => {
    const state = { armed: false, lastAlertAt: minutesAgo(30) };
    expect(evaluateTier({ price: 99, level, state, now })).toBe("none");
    expect(evaluateTier({ price: 100.5, level, state, now })).toBe("none");
  });

  it("re-arms only after a bounce above the buffer, then alerts on the next touch", () => {
    const disarmed = { armed: false, lastAlertAt: minutesAgo(120) };
    expect(evaluateTier({ price: 101.5, level, state: disarmed, now })).toBe("rearm");
    const rearmed = { armed: true, lastAlertAt: minutesAgo(120) };
    expect(evaluateTier({ price: 100, level, state: rearmed, now })).toBe("alert");
  });

  it("respects the cooldown even when re-armed", () => {
    const state = { armed: true, lastAlertAt: minutesAgo(10) };
    expect(evaluateTier({ price: 99, level, state, now })).toBe("none");
  });

  it("counts an earlier intraday touch when the day's low is supplied", () => {
    expect(evaluateTier({ price: 104, level, state: undefined, now })).toBe("none");
    expect(evaluateTier({ price: 104, level, state: undefined, now, low: 99.5 })).toBe("alert");
  });
});
