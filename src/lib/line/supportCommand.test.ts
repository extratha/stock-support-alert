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
    const t = formatSupportReply(all, []).join("\n");
    expect(t).toContain("NVDA — $180.00");
    expect(t).toContain('แนวรับแรก: $170.00 (MA50) [5.9% จากแนวรับ]');
    expect(t).toContain("AMD — ยังไม่มีราคา");
  });
  it("filters to requested symbols and reports unknown ones", () => {
    const t = formatSupportReply(all, ["AMD", "TSLA"]).join("\n");
    expect(t).not.toContain("NVDA");
    expect(t).toContain("ไม่พบในรายการที่ track: TSLA");
  });
  it("handles an empty watchlist", () => {
    expect(formatSupportReply([], []).join("\n")).toContain("ยังไม่มีหุ้น");
  });

  it("splits 30 symbols across messages, each under LINE's 5000-char limit, without losing any symbol", () => {
    const many: StockSnapshot[] = Array.from({ length: 30 }, (_, i) => ({
      symbol: `SYM${String(i).padStart(2, "0")}`,
      price: 1234.56,
      quoteTime: new Date(),
      levels: [
        { tier: "minor", price: 1200.12, method: "pivot_s1" },
        { tier: "intermediate", price: 1100.12, method: "swing_low" },
        { tier: "major", price: 901.98, method: "fib_618" },
      ],
    }));
    const messages = formatSupportReply(many, []);
    expect(messages.length).toBeGreaterThan(1);
    expect(messages.length).toBeLessThanOrEqual(5);
    expect(messages.every((m) => m.length <= 5000)).toBe(true);
    const all = messages.join("\n");
    for (const s of many) expect(all).toContain(s.symbol);
  });

  it("shows the quote time as DD/MM/YYYY HH:mm:ss (Gregorian year)", () => {
    const t = formatSupportReply(
      [{ symbol: "NVDA", price: 200, quoteTime: new Date("2026-09-29T13:30:05Z"), levels: [] }],
      [],
    ).join("\n");
    expect(t).toContain("ราคา ณ 29/09/2026 20:30:05");
  });
});
