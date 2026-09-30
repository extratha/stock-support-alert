import { describe, expect, it } from "vitest";
import type { Candle } from "@/lib/support/types";
import { formatLateMessages } from "./format";
import { findLateEvents, type PreviousLevel } from "./lateCheck";

const bar = (date: string, low: number, close: number): Candle => ({ date, open: close, high: close, low, close, volume: 1 });
const major: PreviousLevel = { tier: "major", method: "ma200", price: 100, zoneLow: null, asOf: "2026-09-28" };
const opts = (armed: boolean) => ({ tiers: ["major" as const], isArmed: () => armed });

describe("findLateEvents", () => {
  const before = bar("2026-09-28", 105, 106); // the bar the levels came from: never re-checked

  it("a touch no alert went out for (e.g. after the 13:30 check)", () => {
    const [e] = findLateEvents("NVDA", [major], [before, bar("2026-09-29", 100.2, 102)], opts(true));
    expect(e).toMatchObject({ symbol: "NVDA", tier: "major", date: "2026-09-29", low: 100.2, close: 102, missedTouch: true, broke: false });
  });

  it("nothing new when the live check already alerted and the level held", () => {
    expect(findLateEvents("NVDA", [major], [before, bar("2026-09-29", 99, 102)], opts(false))).toEqual([]);
  });

  it("a close under the level is a break, even if the touch was already alerted", () => {
    const [e] = findLateEvents("NVDA", [major], [before, bar("2026-09-29", 96, 97.5)], opts(false));
    expect(e).toMatchObject({ missedTouch: false, broke: true, low: 96, close: 97.5 });
  });

  it("a swing zone only breaks under its bottom", () => {
    const zone: PreviousLevel = { ...major, method: "swing_low", price: 100, zoneLow: 98.5 };
    expect(findLateEvents("X", [zone], [before, bar("2026-09-29", 99, 99)], opts(false))).toEqual([]);
    expect(findLateEvents("X", [zone], [before, bar("2026-09-29", 97, 98)], opts(false))[0]).toMatchObject({ broke: true });
  });

  it("ignores tiers that do not alert, untouched levels and bars the levels already knew", () => {
    const minor: PreviousLevel = { ...major, tier: "minor" };
    expect(findLateEvents("X", [minor], [before, bar("2026-09-29", 90, 91)], opts(true))).toEqual([]);
    expect(findLateEvents("X", [major], [before, bar("2026-09-29", 101, 103)], opts(true))).toEqual([]);
    expect(findLateEvents("X", [major], [bar("2026-09-28", 90, 91)], opts(true))).toEqual([]);
  });

  it("covers every day since the levels were computed (a missed recalculation)", () => {
    const [e] = findLateEvents("X", [major], [before, bar("2026-09-29", 104, 104), bar("2026-09-30", 99.9, 98)], opts(true));
    expect(e).toMatchObject({ date: "2026-09-30", low: 99.9, close: 98, missedTouch: true, broke: true });
  });
});

describe("formatLateMessages", () => {
  const base = { symbol: "NVDA", tier: "major" as const, method: "ma200" as const, level: 100, zoneLow: null, date: "2026-09-29", low: 96, close: 97.5 };

  it("a break says where it closed and which level replaces it", () => {
    const text = formatLateMessages([{ ...base, missedTouch: false, broke: true, next: { price: 88.4, method: "fib_618" } }]).join("\n");
    expect(text).toContain('NVDA หลุด "แนวรับสำคัญ" $100.00 (MA200)');
    expect(text).toContain("29/09/2026");
    expect(text).toContain("ปิด $97.50 (-2.5% จากแนวรับ)");
    expect(text).toContain("แนวรับสำคัญใหม่: $88.40 (Fib 61.8%)");
    expect(formatLateMessages([{ ...base, missedTouch: false, broke: true, next: null }]).join("\n")).toContain("ไม่มีแนวรับสำคัญที่ต่ำกว่านี้แล้ว");
  });

  it("a late touch that held", () => {
    const text = formatLateMessages([{ ...base, low: 100.1, close: 102, missedTouch: true, broke: false, next: null }]).join("\n");
    expect(text).toContain('NVDA แตะ "แนวรับสำคัญ" $100.00 (MA200) หลังรอบเช็ก');
    expect(text).not.toContain("ใหม่");
  });
});
