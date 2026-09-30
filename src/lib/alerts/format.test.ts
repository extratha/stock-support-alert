import { describe, expect, it } from "vitest";
import { formatAlertMessages } from "./format";

describe("formatAlertMessages", () => {
  it("names the stock, tier, price and level", () => {
    const text = formatAlertMessages(
      [{ symbol: "NVDA", tier: "minor", method: "ma50", price: 178.2, level: 178.5 }],
      "30 ก.ย. 2569 10:45",
    ).join("\n");
    expect(text).toContain('NVDA แตะ "แนวรับแรก"');
    expect(text).toContain("$178.20");
    expect(text).toContain("$178.50 (MA50)");
    expect(text).toContain("-0.17%");
  });

  it("batches several alerts into one message", () => {
    const text = formatAlertMessages(
      [
        { symbol: "AMD", tier: "minor", method: "pivot_s1", price: 100, level: 100 },
        { symbol: "AMD", tier: "intermediate", method: "swing_low", price: 100, level: 99 },
      ],
      "t",
    ).join("\n");
    expect(text).toContain("แนวรับแรก");
    expect(text).toContain("แนวรับถัดไป");
  });

  it("keeps a normal run in one message but splits an oversized batch under the LINE limit", () => {
    const item = (i: number) => ({ symbol: `S${i}`, tier: "minor" as const, method: "ma50" as const, price: 99, level: 100 });
    expect(formatAlertMessages([item(1), item(2), item(3)], "t")).toHaveLength(1);
    const many = formatAlertMessages(Array.from({ length: 80 }, (_, i) => item(i)), "t");
    expect(many.length).toBeGreaterThan(1);
    expect(many.every((m) => m.length <= 5000)).toBe(true);
  });
});
