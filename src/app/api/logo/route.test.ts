import { beforeEach, describe, expect, it, vi } from "vitest";

const getLogo = vi.fn();
vi.mock("@/lib/db/logos", () => ({ getLogo }));

const call = async (symbol: string) => {
  const { GET } = await import("./[symbol]/route");
  return GET(new Request(`http://x/api/logo/${symbol}`), { params: Promise.resolve({ symbol }) });
};

beforeEach(() => vi.clearAllMocks());

describe("GET /api/logo/[symbol]", () => {
  it("serves the stored bytes with their type, long caching and hardening headers", async () => {
    const data = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
    getLogo.mockResolvedValue({ data, type: "image/png" });
    const res = await call("nvda"); // case-insensitive
    expect(getLogo).toHaveBeenCalledWith("NVDA");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("cache-control")).toContain("max-age=2592000");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("content-security-policy")).toContain("default-src 'none'");
    expect(Buffer.from(await res.arrayBuffer())).toEqual(data);
  });
  it("404 when there is no logo, 400 for something that is not a ticker (no DB query)", async () => {
    getLogo.mockResolvedValue(null);
    expect((await call("AMD")).status).toBe(404);
    getLogo.mockClear();
    expect((await call("../etc/passwd")).status).toBe(400);
    expect(getLogo).not.toHaveBeenCalled();
  });
});
