import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSessionToken, SESSION_COOKIE } from "@/lib/session";
import { proxy } from "./proxy";

const config = { username: "owner", password: "pw-123", secret: "s".repeat(32) };

function req(path: string, init: { method?: string; headers?: Record<string, string>; cookie?: string } = {}) {
  const headers = new Headers({ host: "app.example.com", ...init.headers });
  if (init.cookie) headers.set("cookie", `${SESSION_COOKIE}=${init.cookie}`);
  return new NextRequest(`https://app.example.com${path}`, { method: init.method ?? "GET", headers });
}
const passesThrough = (res: Response) => res.headers.get("x-middleware-next") === "1";

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("ADMIN_USERNAME", config.username);
  vi.stubEnv("ADMIN_PASSWORD", config.password);
  vi.stubEnv("SESSION_SECRET", config.secret);
});
afterEach(() => vi.unstubAllEnvs());

describe("proxy (login session)", () => {
  it("redirects an anonymous page visit to /login and remembers where they were going", async () => {
    const res = proxy(req("/symbols?tab=1"));
    expect(res.status).toBe(307);
    expect(new URL(res.headers.get("location")!).pathname).toBe("/login");
    expect(new URL(res.headers.get("location")!).searchParams.get("next")).toBe("/symbols?tab=1");
    expect(new URL(proxy(req("/")).headers.get("location")!).search).toBe(""); // home needs no ?next
  });

  it("answers anonymous API calls with 401 JSON (no redirect)", async () => {
    const res = proxy(req("/api/symbols"));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
  });

  it("lets a valid session through, and rejects forged / expired / other-user tokens", () => {
    expect(passesThrough(proxy(req("/symbols", { cookie: createSessionToken(config) })))).toBe(true);
    expect(proxy(req("/symbols", { cookie: "forged.value" })).status).toBe(307);
    expect(proxy(req("/symbols", { cookie: createSessionToken(config, Date.now() - 8 * 24 * 3600 * 1000) })).status).toBe(307);
    expect(proxy(req("/symbols", { cookie: createSessionToken({ ...config, password: "other" }) })).status).toBe(307);
  });

  it("keeps the login page and auth endpoints public", () => {
    expect(passesThrough(proxy(req("/login")))).toBe(true);
    expect(passesThrough(proxy(req("/api/auth/login", { method: "POST" })))).toBe(true);
    expect(passesThrough(proxy(req("/api/auth/logout", { method: "POST" })))).toBe(true);
  });

  it("blocks cross-site writes even with a valid session, but allows same-site ones", () => {
    const cookie = createSessionToken(config);
    const evil = proxy(req("/api/symbols", { method: "POST", cookie, headers: { origin: "https://evil.example" } }));
    expect(evil.status).toBe(403);
    const fetchMeta = proxy(req("/api/symbols", { method: "POST", cookie, headers: { "sec-fetch-site": "cross-site" } }));
    expect(fetchMeta.status).toBe(403);
    const ok = proxy(req("/api/symbols", { method: "POST", cookie, headers: { origin: "https://app.example.com" } }));
    expect(passesThrough(ok)).toBe(true);
    // the public login endpoint is protected against cross-site posts too
    expect(proxy(req("/api/auth/login", { method: "POST", headers: { origin: "https://evil.example" } })).status).toBe(403);
  });

  it("fails closed in production when login is not configured", () => {
    vi.stubEnv("SESSION_SECRET", "");
    expect(proxy(req("/")).status).toBe(503);
    vi.stubEnv("SESSION_SECRET", config.secret);
    vi.stubEnv("ADMIN_PASSWORD", "");
    expect(proxy(req("/")).status).toBe(503);
  });

  it("skips the login in local development when no password is set", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("ADMIN_PASSWORD", "");
    expect(passesThrough(proxy(req("/symbols")))).toBe(true);
  });
});

describe("proxy matcher", () => {
  it("leaves cron, webhook and static assets outside the login gate", async () => {
    const { config: m } = await import("./proxy");
    const regex = new RegExp(`^${m.matcher[0]}$`);
    for (const p of ["/api/cron/check", "/api/cron/quotes", "/api/line/webhook", "/icon.svg", "/bell-icon.svg", "/apple-icon.png", "/favicon.ico", "/_next/static/x.js"]) {
      expect(regex.test(p), p).toBe(false);
    }
    for (const p of ["/", "/symbols", "/history", "/recipients", "/api/symbols", "/api/line/test", "/api/line/users/Uabc", "/login"]) {
      expect(regex.test(p), p).toBe(true);
    }
  });
});
