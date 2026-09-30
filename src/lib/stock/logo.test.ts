import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchLogo, isAllowedLogoUrl, MAX_LOGO_BYTES, sniffImageType } from "./logo";

const png = (size = 1000) => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(size)]);
const jpeg = () => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(800)]);
const img = (buf: Buffer, url = "") => {
  const res = new Response(new Uint8Array(buf), { headers: { "Content-Type": "application/octet-stream" } });
  if (url) Object.defineProperty(res, "url", { value: url });
  return res;
};
const json = (o: unknown) => new Response(JSON.stringify(o));

describe("sniffImageType", () => {
  it("recognises PNG, JPEG, GIF and WebP by their bytes", () => {
    expect(sniffImageType(png())).toBe("image/png");
    expect(sniffImageType(jpeg())).toBe("image/jpeg");
    expect(sniffImageType(Buffer.from("GIF89a-and-more"))).toBe("image/gif");
    expect(sniffImageType(Buffer.from("RIFF\u0000\u0000\u0000\u0000WEBPVP8 "))).toBe("image/webp");
  });
  it("rejects SVG, HTML, text and too-short input (whatever the server claimed)", () => {
    expect(sniffImageType(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'))).toBeNull();
    expect(sniffImageType(Buffer.from("<!doctype html><html></html>"))).toBeNull();
    expect(sniffImageType(Buffer.from("404 page not found"))).toBeNull();
    expect(sniffImageType(Buffer.alloc(0))).toBeNull();
  });
});

describe("isAllowedLogoUrl", () => {
  it("only follows https URLs on the provider's own domain", () => {
    expect(isAllowedLogoUrl("finnhub", "https://static2.finnhub.io/file/x.png")).toBe(true);
    expect(isAllowedLogoUrl("twelvedata", "https://api.twelvedata.com/logo/nvidia.com")).toBe(true);
    expect(isAllowedLogoUrl("fmp", "https://financialmodelingprep.com/image-stock/NVDA.png")).toBe(true);
    expect(isAllowedLogoUrl("finnhub", "http://static2.finnhub.io/x.png")).toBe(false); // not https
    expect(isAllowedLogoUrl("finnhub", "https://finnhub.io.evil.com/x.png")).toBe(false); // look-alike host
    expect(isAllowedLogoUrl("finnhub", "https://evil.com/finnhub.io/x.png")).toBe(false);
    expect(isAllowedLogoUrl("fmp", "https://static2.finnhub.io/x.png")).toBe(false); // wrong provider
    expect(isAllowedLogoUrl("finnhub", "not a url")).toBe(false);
    expect(isAllowedLogoUrl("finnhub", "http://169.254.169.254/latest/meta-data")).toBe(false);
  });
});

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("FINNHUB_API_KEY", "fh-key");
  vi.stubEnv("STOCK_API_KEY", "td-key");
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const urls = () => fetchMock.mock.calls.map((c) => String(c[0]));

describe("fetchLogo chain (FMP -> Finnhub -> Twelve Data)", () => {
  it("uses FMP first and does not bother the other sources when it works", async () => {
    fetchMock.mockImplementation(async () => img(png(), "https://financialmodelingprep.com/image-stock/NVDA.png"));
    const { logo } = await fetchLogo("NVDA");
    expect(logo).toMatchObject({ type: "image/png", source: "fmp" });
    expect(urls()).toHaveLength(1);
  });

  it("falls back to Finnhub when FMP has no such symbol (404), following its redirect within finnhub.io", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes("financialmodelingprep")) return new Response("Not Found", { status: 404 });
      if (url.includes("/stock/profile2")) return json({ logo: "https://static2.finnhub.io/file/x/AMD.png" });
      return img(png(), "https://static9.finnhub.io/file/x/AMD.png"); // redirected to another finnhub host: fine
    });
    const { logo, errors } = await fetchLogo("AMD");
    expect(logo?.source).toBe("finnhub");
    expect(errors[0]).toContain("fmp: HTTP 404");
  });

  it("falls back to Twelve Data when FMP and Finnhub both have nothing", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes("financialmodelingprep")) return new Response("", { status: 404 });
      if (url.includes("/stock/profile2")) return json({}); // Finnhub: unknown symbol -> empty profile
      if (url.includes("api.twelvedata.com/logo?")) return json({ url: "https://api.twelvedata.com/logo/intl.com" });
      return img(jpeg());
    });
    const { logo, errors } = await fetchLogo("INTL");
    expect(logo).toMatchObject({ source: "twelvedata", type: "image/jpeg" });
    expect(errors.join(" | ")).toContain("finnhub: no logo in profile");
  });

  it("skips sources whose API key is not configured", async () => {
    vi.stubEnv("FINNHUB_API_KEY", "");
    vi.stubEnv("STOCK_API_KEY", "");
    fetchMock.mockImplementation(async () => new Response("", { status: 404 }));
    const { logo, errors } = await fetchLogo("ZZZ");
    expect(logo).toBeUndefined();
    expect(urls()).toHaveLength(1); // only FMP was called
    expect(errors).toEqual(["fmp: HTTP 404", "finnhub: no API key", "twelvedata: no API key"]);
  });

  it("refuses a logo URL that an API points at another domain (and then moves on)", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes("financialmodelingprep")) return new Response("", { status: 404 });
      if (url.includes("/stock/profile2")) return json({ logo: "https://evil.example/logo.png" });
      if (url.includes("api.twelvedata.com/logo?")) return json({ url: "https://api.twelvedata.com/logo/x.com" });
      return img(png());
    });
    const { logo, errors } = await fetchLogo("XYZ");
    expect(urls().some((u) => u.includes("evil.example"))).toBe(false); // never requested
    expect(errors.join(" | ")).toContain("finnhub: URL not on the provider's domain");
    expect(logo?.source).toBe("twelvedata");
  });

  it("refuses a redirect that ends up on another domain", async () => {
    fetchMock.mockImplementation(async (url: string) =>
      url.includes("financialmodelingprep") ? img(png(), "https://evil.example/x.png") : new Response("", { status: 404 }),
    );
    const { errors } = await fetchLogo("XYZ");
    expect(errors[0]).toContain("redirected off the provider's domain");
  });

  it("rejects non-images, tiny placeholders and oversized files, whatever Content-Type says", async () => {
    for (const [body, why] of [
      [Buffer.from("<svg onload=alert(1)>".padEnd(500, " ")), "not a PNG/JPEG/GIF/WebP image"],
      [png(50), "too small"],
      [png(MAX_LOGO_BYTES + 10), "too large"],
    ] as [Buffer, string][]) {
      fetchMock.mockReset();
      fetchMock.mockImplementation(async (url: string) => (url.includes("financialmodelingprep") ? img(body) : new Response("", { status: 404 })));
      const { logo, errors } = await fetchLogo("NVDA");
      expect(logo).toBeUndefined();
      expect(errors[0]).toContain(why);
    }
  });

  it("returns within the deadline when every source hangs, without throwing", async () => {
    fetchMock.mockImplementation(
      (_url: string, init: RequestInit) => new Promise((_r, reject) => init.signal?.addEventListener("abort", () => reject(new Error("aborted")))),
    );
    const started = Date.now();
    const { logo, errors } = await fetchLogo("NVDA", { deadlineMs: 150 });
    expect(logo).toBeUndefined();
    expect(Date.now() - started).toBeLessThan(2000);
    expect(errors.length).toBe(3);
  });
});
