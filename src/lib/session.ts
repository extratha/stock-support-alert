import { createHmac } from "node:crypto";
import { safeEqual, type AuthConfig } from "./auth";

export const SESSION_COOKIE = "ssa_session";
export const SESSION_MAX_AGE_S = 7 * 24 * 60 * 60; // 7 days, not extended by activity

/**
 * Stateless session: `base64url(payload).signature`. Nothing is stored server-side, so
 * "logout" clears the cookie and changing ADMIN_USERNAME / ADMIN_PASSWORD / SESSION_SECRET
 * signs everyone out: the signing key is derived from all three.
 */
function signingKey({ secret, username, password }: AuthConfig): Buffer {
  return createHmac("sha256", secret).update(`${username}\n${password}`).digest();
}

const sign = (payload: string, config: AuthConfig) =>
  createHmac("sha256", signingKey(config)).update(payload).digest("base64url");

export function createSessionToken(config: AuthConfig, now: number = Date.now()): string {
  const payload = Buffer.from(JSON.stringify({ u: config.username, exp: now + SESSION_MAX_AGE_S * 1000 })).toString(
    "base64url",
  );
  return `${payload}.${sign(payload, config)}`;
}

export function verifySessionToken(token: string, config: AuthConfig, now: number = Date.now()): boolean {
  const dot = token.indexOf(".");
  if (dot < 1) return false;
  const payload = token.slice(0, dot);
  if (!safeEqual(token.slice(dot + 1), sign(payload, config))) return false;
  try {
    const { u, exp } = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { u?: unknown; exp?: unknown };
    return u === config.username && typeof exp === "number" && exp > now;
  } catch {
    return false;
  }
}
