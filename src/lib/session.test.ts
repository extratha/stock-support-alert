import { describe, expect, it } from "vitest";
import { checkCredentials, loadAuthSetup, type AuthConfig } from "./auth";
import { createSessionToken, SESSION_MAX_AGE_S, verifySessionToken } from "./session";
import { safeNextPath } from "./safeNext";

const config: AuthConfig = { username: "owner", password: "correct horse", secret: "s".repeat(32) };
const t0 = 1_800_000_000_000;

describe("session token", () => {
  it("round-trips while valid", () => {
    const token = createSessionToken(config, t0);
    expect(verifySessionToken(token, config, t0 + 1000)).toBe(true);
  });

  it("expires after 7 days", () => {
    const token = createSessionToken(config, t0);
    expect(verifySessionToken(token, config, t0 + SESSION_MAX_AGE_S * 1000 - 1)).toBe(true);
    expect(verifySessionToken(token, config, t0 + SESSION_MAX_AGE_S * 1000 + 1)).toBe(false);
  });

  it("rejects tampering, garbage and empty input", () => {
    const token = createSessionToken(config, t0);
    const [payload, sig] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ u: "owner", exp: t0 + 10 * SESSION_MAX_AGE_S * 1000 })).toString("base64url");
    expect(verifySessionToken(`${forged}.${sig}`, config, t0)).toBe(false);
    expect(verifySessionToken(`${payload}.${sig}x`, config, t0)).toBe(false);
    for (const bad of ["", ".", "abc", "a.b", `${payload}.`]) expect(verifySessionToken(bad, config, t0)).toBe(false);
  });

  it("is invalidated by changing the password, username or secret", () => {
    const token = createSessionToken(config, t0);
    expect(verifySessionToken(token, { ...config, password: "new" }, t0)).toBe(false);
    expect(verifySessionToken(token, { ...config, username: "other" }, t0)).toBe(false);
    expect(verifySessionToken(token, { ...config, secret: "t".repeat(32) }, t0)).toBe(false);
  });
});

describe("checkCredentials", () => {
  it("needs both username and password right", () => {
    expect(checkCredentials("owner", "correct horse", config)).toBe(true);
    expect(checkCredentials("owner", "wrong", config)).toBe(false);
    expect(checkCredentials("admin", "correct horse", config)).toBe(false);
    expect(checkCredentials("", "", config)).toBe(false);
  });
});

describe("loadAuthSetup", () => {
  const env = (o: Record<string, string>) => o as unknown as NodeJS.ProcessEnv;
  it("production: refuses without a password or with a missing/short secret", () => {
    expect(loadAuthSetup(env({ NODE_ENV: "production" }))).toEqual({ ok: false, reason: "misconfigured" });
    expect(loadAuthSetup(env({ NODE_ENV: "production", ADMIN_PASSWORD: "p" }))).toEqual({ ok: false, reason: "misconfigured" });
    expect(loadAuthSetup(env({ NODE_ENV: "production", ADMIN_PASSWORD: "p", SESSION_SECRET: "short" }))).toEqual({
      ok: false,
      reason: "misconfigured",
    });
  });
  it("production: works with a proper secret, username defaults to admin", () => {
    const r = loadAuthSetup(env({ NODE_ENV: "production", ADMIN_PASSWORD: "p", SESSION_SECRET: "x".repeat(20) }));
    expect(r).toMatchObject({ ok: true, config: { username: "admin", password: "p" } });
    const named = loadAuthSetup(env({ NODE_ENV: "production", ADMIN_PASSWORD: "p", SESSION_SECRET: "x".repeat(20), ADMIN_USERNAME: "me" }));
    expect(named).toMatchObject({ ok: true, config: { username: "me" } });
  });
  it("development: no password means login is disabled; a password works without SESSION_SECRET", () => {
    expect(loadAuthSetup(env({ NODE_ENV: "development" }))).toEqual({ ok: false, reason: "disabled" });
    expect(loadAuthSetup(env({ NODE_ENV: "development", ADMIN_PASSWORD: "p" })).ok).toBe(true);
  });
});

describe("safeNextPath", () => {
  it("keeps same-site paths", () => {
    expect(safeNextPath("/symbols")).toBe("/symbols");
    expect(safeNextPath("/history?x=1")).toBe("/history?x=1");
  });
  it("blocks open redirects and loops", () => {
    for (const bad of ["//evil.com", "https://evil.com", "/\\evil.com", "javascript:alert(1)", "", null, undefined, "/login", "/api/symbols"]) {
      expect(safeNextPath(bad)).toBe("/");
    }
  });
});
