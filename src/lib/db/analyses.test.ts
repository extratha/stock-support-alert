import { describe, expect, it } from "vitest";
import { toView } from "./analyses";

const row = (result: unknown) => ({ id: 5, created_at: new Date("2026-10-05T07:53:40.822Z"), goals: "growth,dividend,bogus", model: "gemini-x", result: result as never });
const stored = { summary: "สรุป", picks: [{ rank: 1, symbol: "NVDA", price: 180, reasons: ["r"], risks: ["k"], entryNote: "n" }], caveats: ["c"], universe: 11, skipped: [] };

describe("toView", () => {
  it("reads a stored result", () => {
    expect(toView(row(stored))).toEqual({ id: 5, createdAt: "2026-10-05T07:53:40.822Z", model: "gemini-x", goals: ["growth", "dividend"], ...stored });
  });

  it("reads a row written as a JSON string (postgres.js stringified an already-stringified value for jsonb)", () => {
    expect(toView(row(JSON.stringify(stored)))).toMatchObject({ summary: "สรุป", universe: 11, picks: [{ symbol: "NVDA" }] });
  });

  it("never hands the page something it would crash on: missing, odd or unreadable results become empty ones", () => {
    for (const odd of [null, "not json", "\"just a string\"", 42, { picks: "x", caveats: null }, { picks: [{ symbol: "AMD" }] }]) {
      const v = toView(row(odd));
      expect(typeof v.summary).toBe("string");
      expect(Array.isArray(v.picks)).toBe(true);
      expect(Array.isArray(v.caveats)).toBe(true);
      expect(Array.isArray(v.skipped)).toBe(true);
      for (const p of v.picks) expect(Array.isArray(p.reasons) && Array.isArray(p.risks)).toBe(true);
    }
  });
});
