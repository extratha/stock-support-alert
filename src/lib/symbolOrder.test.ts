import { describe, expect, it } from "vitest";
import { mergeOrder } from "./symbolOrder";

describe("mergeOrder", () => {
  const current = ["AMD", "NVDA", "PLTR"];
  it("applies the requested order", () => {
    expect(mergeOrder(current, ["PLTR", "AMD", "NVDA"])).toEqual(["PLTR", "AMD", "NVDA"]);
  });
  it("drops unknown and duplicate entries", () => {
    expect(mergeOrder(current, ["NVDA", "XXXX", "NVDA", "AMD", "PLTR"])).toEqual(["NVDA", "AMD", "PLTR"]);
  });
  it("keeps symbols the client did not mention (stale client) after the requested ones", () => {
    expect(mergeOrder(current, ["PLTR"])).toEqual(["PLTR", "AMD", "NVDA"]);
  });
  it("handles an empty request", () => {
    expect(mergeOrder(current, [])).toEqual(current);
  });
});
