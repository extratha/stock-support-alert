import { describe, expect, it } from "vitest";
import { formatSupportReply, parseSupportCommand, type StockSnapshot } from "./supportCommand";

describe("parseSupportCommand", () => {
  it("bare command means all tracked symbols", () => {
    expect(parseSupportCommand("ขอแนวรับ")).toEqual({ symbols: [] });
    expect(parseSupportCommand("  ขอแนวรับ  ")).toEqual({ symbols: [] });
  });
  it("extracts symbols, case-insensitive, deduped, ignoring filler words", () => {
    expect(parseSupportCommand("ขอแนวรับ nvda, AMD และ amd")).toEqual({ symbols: ["NVDA", "AMD"] });
    expect(parseSupportCommand("ขอแนวรับ หุ้น brk.b")).toEqual({ symbols: ["BRK.B"] });
  });
  it("ignores other messages", () => {
    expect(parseSupportCommand("สวัสดี")).toBeNull();
    expect(parseSupportCommand("แนวรับ NVDA")).toBeNull();
  });
});

describe("formatSupportReply", () => {
  const all: StockSnapshot[] = [
    { symbol: "NVDA", price: 180, quoteTime: null, levels: [{ tier: "minor", price: 170, method: "ma50" }] },
    { symbol: "AMD", price: null, quoteTime: null, levels: [] },
  ];
  it("lists every tracked symbol when none requested", () => {
    const t = formatSupportReply(all, []);
    expect(t).toContain("NVDA — $180.00");
    expect(t).toContain('แนวรับแรก: $170.00 (MA50) [5.9% จากแนวรับ]');
    expect(t).toContain("AMD — ยังไม่มีราคา");
  });
  it("filters to requested symbols and reports unknown ones", () => {
    const t = formatSupportReply(all, ["AMD", "TSLA"]);
    expect(t).not.toContain("NVDA");
    expect(t).toContain("ไม่พบในรายการที่ track: TSLA");
  });
  it("handles an empty watchlist", () => {
    expect(formatSupportReply([], [])).toContain("ยังไม่มีหุ้น");
  });
});
