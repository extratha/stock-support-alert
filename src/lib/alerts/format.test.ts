import { describe, expect, it } from "vitest";
import { formatAlertMessage } from "./format";

describe("formatAlertMessage", () => {
  it("names the stock, tier, price and level", () => {
    const text = formatAlertMessage(
      [{ symbol: "NVDA", tier: "minor", method: "ma50", price: 178.2, level: 178.5 }],
      "30 ก.ย. 2569 10:45",
    );
    expect(text).toContain('NVDA แตะ "แนวรับแรก"');
    expect(text).toContain("$178.20");
    expect(text).toContain("$178.50 (MA50)");
    expect(text).toContain("-0.17%");
  });

  it("batches several alerts into one message", () => {
    const text = formatAlertMessage(
      [
        { symbol: "AMD", tier: "minor", method: "pivot_s1", price: 100, level: 100 },
        { symbol: "AMD", tier: "intermediate", method: "swing_low", price: 100, level: 99 },
      ],
      "t",
    );
    expect(text).toContain("แนวรับแรก");
    expect(text).toContain("แนวรับถัดไป");
  });
});
