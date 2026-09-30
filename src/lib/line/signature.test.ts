import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyLineSignature } from "./signature";

const secret = "channel-secret";
const body = JSON.stringify({ events: [] });
const sign = (b: string, s = secret) => createHmac("sha256", s).update(b).digest("base64");

describe("verifyLineSignature", () => {
  it("accepts a valid signature", () => expect(verifyLineSignature(body, sign(body), secret)).toBe(true));
  it("rejects a tampered body", () => expect(verifyLineSignature(body + " ", sign(body), secret)).toBe(false));
  it("rejects a wrong secret / missing / malformed header", () => {
    expect(verifyLineSignature(body, sign(body, "other"), secret)).toBe(false);
    expect(verifyLineSignature(body, null, secret)).toBe(false);
    expect(verifyLineSignature(body, "abc", secret)).toBe(false);
  });
});
