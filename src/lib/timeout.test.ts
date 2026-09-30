import { describe, expect, it } from "vitest";
import { TimeoutError, withTimeout } from "./timeout";

describe("withTimeout", () => {
  it("returns the result when the work finishes in time", async () => {
    await expect(withTimeout(Promise.resolve(7), 500, "x")).resolves.toBe(7);
  });
  it("rejects with a TimeoutError when the work never finishes", async () => {
    const started = Date.now();
    await expect(withTimeout(new Promise(() => {}), 80, "load page")).rejects.toBeInstanceOf(TimeoutError);
    expect(Date.now() - started).toBeLessThan(1000);
  });
  it("passes through the work's own errors", async () => {
    await expect(withTimeout(Promise.reject(new Error("db down")), 500, "x")).rejects.toThrow("db down");
  });
});
