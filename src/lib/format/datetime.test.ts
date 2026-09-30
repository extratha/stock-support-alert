import { describe, expect, it } from "vitest";
import { formatDateString, formatDateTime } from "./datetime";

describe("formatDateTime", () => {
  const instant = new Date("2026-09-29T13:30:05Z");
  it("uses DD/MM/YYYY HH:mm:ss with a Gregorian year, in Thailand time by default", () => {
    expect(formatDateTime(instant)).toBe("29/09/2026 20:30:05");
  });
  it("supports another time zone (New York, DST aware)", () => {
    expect(formatDateTime(instant, "America/New_York")).toBe("29/09/2026 09:30:05");
    expect(formatDateTime(new Date("2026-01-14T14:30:00Z"), "America/New_York")).toBe("14/01/2026 09:30:00");
  });
  it("uses 24-hour time, with 00 (not 24) at midnight and zero padding", () => {
    expect(formatDateTime(new Date("2026-03-04T17:00:00Z"))).toBe("05/03/2026 00:00:00");
  });
});

describe("formatDateString", () => {
  it("converts ISO dates without touching time zones", () => {
    expect(formatDateString("2026-09-29")).toBe("29/09/2026");
  });
  it("leaves anything else alone", () => {
    expect(formatDateString("n/a")).toBe("n/a");
  });
});
