import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { verifySessionToken, SESSION_COOKIE, SESSION_MAX_AGE_S } from "@/lib/session";

const config = { username: "owner", password: "pw-123", secret: "s".repeat(32) };

beforeEach(() => {
  vi.stubEnv("ADMIN_USERNAME", config.username);
  vi.stubEnv("ADMIN_PASSWORD", config.password);
  vi.stubEnv("SESSION_SECRET", config.secret);
});
afterEach(() => vi.unstubAllEnvs());

const post = async (body: unknown) => {
  const { POST } = await import("./login/route");
  return POST(new Request("http://x/api/auth/login", { method: "POST", body: JSON.stringify(body) }));
};

describe("POST /api/auth/login", () => {
  it("accepts the right username + password and sets a signed, HttpOnly session cookie", async () => {
    const res = await post({ username: "owner", password: "pw-123" });
    expect(res.status).toBe(200);
    const cookie = res.headers.get("set-cookie")!;
    expect(cookie).toContain(`${SESSION_COOKIE}=`);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=lax/i);
    expect(cookie).toMatch(/Path=\//);
    expect(cookie).toContain(`Max-Age=${SESSION_MAX_AGE_S}`);
    const token = decodeURIComponent(cookie.split(";")[0].split("=").slice(1).join("="));
    expect(verifySessionToken(token, config)).toBe(true);
  });

  it("marks the cookie Secure in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const res = await post({ username: "owner", password: "pw-123" });
    expect(res.headers.get("set-cookie")).toMatch(/Secure/i);
  });

  it("rejects a wrong password or username with the same generic 401, and no cookie", async () => {
    const wrongPass = await post({ username: "owner", password: "nope" });
    const wrongUser = await post({ username: "admin", password: "pw-123" });
    for (const res of [wrongPass, wrongUser]) {
      expect(res.status).toBe(401);
      expect(res.headers.get("set-cookie")).toBeNull();
    }
    expect(await wrongPass.json()).toEqual(await wrongUser.json());
  });

  it("rejects malformed bodies", async () => {
    expect((await post({})).status).toBe(401);
    expect((await post({ username: 1, password: 2 })).status).toBe(401);
  });

  it("refuses when login is not configured in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("SESSION_SECRET", "");
    expect((await post({ username: "owner", password: "pw-123" })).status).toBe(503);
  });
});

describe("POST /api/auth/logout", () => {
  it("expires the session cookie", async () => {
    const { POST } = await import("./logout/route");
    const res = await POST();
    expect(res.status).toBe(200);
    const cookie = res.headers.get("set-cookie")!;
    expect(cookie).toContain(`${SESSION_COOKIE}=;`);
    expect(cookie).toMatch(/Max-Age=0/);
    expect(cookie).toMatch(/HttpOnly/i);
  });
});
