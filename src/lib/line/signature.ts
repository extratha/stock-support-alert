import { createHmac, timingSafeEqual } from "node:crypto";

/** LINE signs the raw request body with HMAC-SHA256 (channel secret) and sends it base64 in `x-line-signature`. */
export function verifyLineSignature(rawBody: string, signature: string | null, channelSecret: string): boolean {
  if (!signature) return false;
  const expected = createHmac("sha256", channelSecret).update(rawBody).digest();
  const actual = Buffer.from(signature, "base64");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
