import { describe, expect, it } from "vitest";
import { formatGuide, isHelpCommand } from "./guide";
import { parseSupportCommand } from "./supportCommand";

describe("formatGuide", () => {
  it("welcomes new friends and teaches both commands with real tracked symbols", () => {
    const text = formatGuide(["AMD", "NVDA", "TSM"], { welcome: true });
    expect(text).toContain("ยินดีต้อนรับ");
    expect(text).toContain("• ขอแนวรับ →");
    expect(text).toContain("• ขอแนวรับของ AMD →");
    expect(text).toContain("• ขอแนวรับ AMD NVDA →");
    expect(text).toContain("หุ้นที่ติดตามอยู่: AMD, NVDA, TSM");
    expect(text).toContain("แนวรับแรก");
  });

  it("every example in the guide is a command the bot really understands", () => {
    const text = formatGuide(["AMD", "NVDA"], { welcome: true });
    const examples = [...text.matchAll(/^• (ขอแนวรับ[^→]*?) →/gm)].map((m) => m[1].trim());
    expect(examples).toEqual(["ขอแนวรับ", "ขอแนวรับของ AMD", "ขอแนวรับ AMD NVDA"]);
    expect(parseSupportCommand(examples[0])).toEqual({ symbols: [] });
    expect(parseSupportCommand(examples[1])).toEqual({ symbols: ["AMD"] });
    expect(parseSupportCommand(examples[2])).toEqual({ symbols: ["AMD", "NVDA"] });
  });

  it("falls back to a sample ticker when nothing is tracked, and omits the multi-symbol example for one stock", () => {
    expect(formatGuide([], { welcome: false })).toContain("ขอแนวรับของ NVDA");
    expect(formatGuide([], { welcome: false })).not.toContain("หุ้นที่ติดตามอยู่");
    expect(formatGuide(["AMD"], { welcome: false })).not.toContain("หลายตัวพร้อมกัน");
  });

  it("the help version has no welcome line and truncates very long lists", () => {
    expect(formatGuide(["AMD"], { welcome: false })).not.toContain("ยินดีต้อนรับ");
    const many = Array.from({ length: 30 }, (_, i) => `S${i}`);
    const text = formatGuide(many, { welcome: true });
    expect(text).toContain("S19 …");
    expect(text).not.toContain("S20");
    expect(text.length).toBeLessThan(1000);
  });
});

describe("isHelpCommand", () => {
  it("recognises the help words (case/space-insensitive) but not normal chat", () => {
    for (const w of ["วิธีใช้", " วิธีใช้ ", "HELP", "help", "ช่วยเหลือ", "เมนู", "?"]) expect(isHelpCommand(w)).toBe(true);
    for (const w of ["สวัสดี", "ขอแนวรับ", "helpme", "วิธีใช้งานยังไง"]) expect(isHelpCommand(w)).toBe(false);
  });
});
