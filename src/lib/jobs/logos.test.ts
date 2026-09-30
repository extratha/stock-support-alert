import { beforeEach, describe, expect, it, vi } from "vitest";

const saveLogo = vi.fn(async () => {});
const markLogoMissing = vi.fn(async () => {});
const symbolsNeedingLogo = vi.fn();
const fetchLogo = vi.fn();
vi.mock("@/lib/db/logos", () => ({ saveLogo, markLogoMissing, symbolsNeedingLogo }));
vi.mock("@/lib/stock/logo", () => ({ fetchLogo }));

const logo = { data: Buffer.alloc(300), type: "image/png", source: "fmp" };

beforeEach(() => vi.clearAllMocks());

describe("ensureLogo", () => {
  it("stores the logo when a source has one", async () => {
    fetchLogo.mockResolvedValue({ logo, errors: [] });
    const { ensureLogo } = await import("./logos");
    expect(await ensureLogo("NVDA")).toEqual({ status: "saved", source: "fmp" });
    expect(saveLogo).toHaveBeenCalledWith("NVDA", logo);
    expect(markLogoMissing).not.toHaveBeenCalled();
  });

  it("remembers the attempt (so it is not retried every run) when no source has one", async () => {
    fetchLogo.mockResolvedValue({ errors: ["fmp: HTTP 404"] });
    const { ensureLogo } = await import("./logos");
    expect(await ensureLogo("ZZZ")).toEqual({ status: "missing", errors: ["fmp: HTTP 404"] });
    expect(markLogoMissing).toHaveBeenCalledWith("ZZZ");
    expect(saveLogo).not.toHaveBeenCalled();
  });

  it("never throws, even if the database is down", async () => {
    fetchLogo.mockResolvedValue({ logo, errors: [] });
    saveLogo.mockRejectedValueOnce(new Error("db down"));
    const { ensureLogo } = await import("./logos");
    expect(await ensureLogo("NVDA")).toEqual({ status: "missing", errors: ["db down"] });
  });
});

describe("backfillLogos", () => {
  it("only works on symbols that need a logo, up to the limit, retrying failures after 7 days by default", async () => {
    symbolsNeedingLogo.mockResolvedValue(["AMD", "INTL"]);
    fetchLogo.mockImplementation(async (s: string) => (s === "AMD" ? { logo, errors: [] } : { errors: ["fmp: HTTP 404"] }));
    const { backfillLogos } = await import("./logos");
    const result = await backfillLogos({ limit: 3 });
    expect(symbolsNeedingLogo).toHaveBeenCalledWith(3, 7);
    expect(result.saved).toEqual(["AMD"]);
    expect(result.missing).toEqual({ INTL: ["fmp: HTTP 404"] });
  });

  it("does nothing (and calls no API) when every symbol already has a logo", async () => {
    symbolsNeedingLogo.mockResolvedValue([]);
    const { backfillLogos } = await import("./logos");
    expect(await backfillLogos()).toEqual({ saved: [], missing: {} });
    expect(fetchLogo).not.toHaveBeenCalled();
  });
});
