import { describe, expect, it, vi } from "vitest";
import { MASKED_ID, toRecipientRows, type FriendRecord } from "./recipients";
import { siteUrl } from "./site";

const friend = (over: Partial<FriendRecord>): FriendRecord => ({
  userId: `U${"a".repeat(32)}`,
  displayName: "Somchai",
  pictureUrl: "https://profile.line-scdn.net/abc",
  label: "my note",
  active: true,
  notify: true,
  publicPhoto: false,
  followedAtLabel: "30/09/2026 10:00:00",
  ...over,
});

describe("toRecipientRows", () => {
  it("gives the owner everything, keyed by the LINE user id", () => {
    const [row] = toRecipientRows([friend({})], true);
    expect(row).toMatchObject({ key: `U${"a".repeat(32)}`, idLabel: "Uaaaa…aaaa", displayName: "Somchai", label: "my note", profileFetched: true });
    expect(row.pictureUrl).toBe("https://profile.line-scdn.net/abc");
  });

  it("removes every personal field for visitors; the picture only when the owner made it public", () => {
    const rows = toRecipientRows([friend({}), friend({ userId: `U${"b".repeat(32)}`, publicPhoto: true }), friend({ displayName: null, pictureUrl: null })], false);
    const sent = JSON.stringify(rows);
    expect(sent).not.toContain("aaaa");
    expect(sent).not.toContain("bbbb");
    expect(sent).not.toContain("Somchai");
    expect(sent).not.toContain("my note");
    expect(rows.map((r) => r.key)).toEqual(["friend-1", "friend-2", "friend-3"]);
    expect(rows.every((r) => r.idLabel === MASKED_ID && r.displayName === null && r.label === null)).toBe(true);
    expect(rows.map((r) => r.pictureUrl)).toEqual([null, "https://profile.line-scdn.net/abc", null]);
    expect(rows.map((r) => r.profileFetched)).toEqual([true, true, false]);
    expect(rows[0]).toMatchObject({ active: true, notify: true, followedAtLabel: "30/09/2026 10:00:00" });
  });
});

describe("siteUrl", () => {
  it("prefers SITE_URL, then Vercel's production address, then local", () => {
    expect(siteUrl({ SITE_URL: "https://stocks.example.com/" } as unknown as NodeJS.ProcessEnv)).toBe("https://stocks.example.com");
    expect(siteUrl({ VERCEL_PROJECT_PRODUCTION_URL: "stock-support-alert.vercel.app" } as unknown as NodeJS.ProcessEnv)).toBe("https://stock-support-alert.vercel.app");
    expect(siteUrl({} as unknown as NodeJS.ProcessEnv)).toBe("http://localhost:3000");
  });
});

describe("robots and sitemap", () => {
  it("let search engines index the public pages, not the API or the login", async () => {
    vi.stubEnv("SITE_URL", "https://stocks.example.com");
    const robots = (await import("@/app/robots")).default();
    expect(robots.rules).toEqual({ userAgent: "*", allow: "/", disallow: ["/api/", "/login"] });
    expect(robots.sitemap).toBe("https://stocks.example.com/sitemap.xml");
    const urls = (await import("@/app/sitemap")).default().map((e) => e.url);
    expect(urls).toEqual([
      "https://stocks.example.com",
      "https://stocks.example.com/analysis",
      "https://stocks.example.com/news",
      "https://stocks.example.com/symbols",
      "https://stocks.example.com/recipients",
      "https://stocks.example.com/history",
    ]);
    vi.unstubAllEnvs();
  });
});
