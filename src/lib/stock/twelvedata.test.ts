import { describe, expect, it } from "vitest";
import { parseQuotes, parseTimeSeries } from "./twelvedata";

describe("parseTimeSeries", () => {
  const values = [
    { datetime: "2026-09-29", open: "10", high: "12", low: "9", close: "11", volume: "100" },
    { datetime: "2026-09-28", open: "9", high: "11", low: "8", close: "10", volume: "90" },
  ];

  it("handles the single-symbol shape and sorts oldest -> newest", () => {
    const r = parseTimeSeries({ status: "ok", values }, ["AMD"]);
    expect(r.data.AMD.map((c) => c.date)).toEqual(["2026-09-28", "2026-09-29"]);
    expect(r.data.AMD[1].close).toBe(11);
  });

  it("handles the batch shape with a per-symbol error", () => {
    const r = parseTimeSeries({ AMD: { status: "ok", values }, XXXX: { status: "error", code: 404, message: "not found" } }, ["AMD", "XXXX"]);
    expect(Object.keys(r.data)).toEqual(["AMD"]);
    expect(r.errors.XXXX).toBe("not found");
  });

  it("throws on request-level errors such as a bad key or rate limit", () => {
    expect(() => parseTimeSeries({ status: "error", code: 429, message: "limit" }, ["AMD"])).toThrow(/429/);
  });
});

describe("parseQuotes", () => {
  it("reads price, previous close and trade time", () => {
    const r = parseQuotes({ symbol: "NVDA", close: "178.20", low: "175.50", previous_close: "176", timestamp: 1790000000 }, ["NVDA"]);
    expect(r.data.NVDA.price).toBe(178.2);
    expect(r.data.NVDA.previousClose).toBe(176);
    expect(r.data.NVDA.dayLow).toBe(175.5);
    expect(r.data.NVDA.quoteTime.getTime()).toBe(1790000000 * 1000);
  });
});
