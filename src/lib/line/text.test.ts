import { describe, expect, it } from "vitest";
import { packBlocks } from "./text";

describe("packBlocks", () => {
  it("puts the header only on the first message and never splits a block", () => {
    const out = packBlocks(["aaaa", "bbbb", "cccc"], { header: "H", limit: 11, separator: "|" });
    expect(out).toEqual(["H|aaaa|bbbb", "cccc"]);
  });
  it("returns a single message when everything fits", () => {
    expect(packBlocks(["a", "b"], { header: "H" })).toEqual(["H\n\na\n\nb"]);
  });
  it("keeps an oversized single block rather than dropping it", () => {
    expect(packBlocks(["x".repeat(20)], { limit: 5 })).toEqual(["x".repeat(20)]);
  });
  it("returns nothing for no blocks and no header", () => {
    expect(packBlocks([])).toEqual([]);
  });
});
