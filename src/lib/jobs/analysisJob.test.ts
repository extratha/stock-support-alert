import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AnalysisView } from "@/lib/analysis/types";

const startAnalysis = vi.fn<(...a: unknown[]) => Promise<number | null>>(async () => 7);
const finishAnalysis = vi.fn(async () => {});
const getAnalysis = vi.fn(async (): Promise<AnalysisView | null> => ({
  id: 7, createdAt: "2026-09-30T14:00:00.000Z", model: "m", goals: ["growth"], summary: "s", picks: [], caveats: [], universe: 2,
}));
vi.mock("@/lib/db/analyses", () => ({ startAnalysis, finishAnalysis, getAnalysis }));
vi.mock("@/lib/db/profiles", () => ({ listProfiles: vi.fn(async () => []) }));
vi.mock("@/lib/db/supports", () => ({ listSupportTests: vi.fn(async () => []) }));
const listTrackedSymbols = vi.fn(async () => [
  { symbol: "NVDA", logoVersion: null, price: 180, quoteTime: null, asOf: null, refClose: 180, levels: [] },
  { symbol: "AMD", logoVersion: null, price: 150, quoteTime: null, asOf: null, refClose: 150, levels: [] },
]);
vi.mock("@/lib/db/symbols", () => ({ listTrackedSymbols }));
const getLivePrices = vi.fn(async () => ({ prices: { NVDA: { price: 182.5, asOf: null, source: "finnhub" } }, errors: {} }));
vi.mock("./livePrices", () => ({ getLivePrices }));
const chat = vi.fn<(a: { system: string; user: string }) => Promise<string>>(async () => JSON.stringify({ summary: "s", picks: [{ symbol: "NVDA", rank: 1, reasons: ["r"], risks: ["k"], entryNote: "n" }] }));
vi.mock("@/lib/ai/client", async (orig) => ({ ...(await orig<typeof import("@/lib/ai/client")>()), chat }));

const { runAnalysis, AnalysisError } = await import("./analysis");
const { AiError } = await import("@/lib/ai/client");

const NOW = new Date("2026-09-30T14:00:00Z");

describe("runAnalysis", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("AI_API_KEY", "k");
    vi.stubEnv("AI_MODEL", "m");
    vi.stubEnv("AI_DAILY_LIMIT", "3");
    startAnalysis.mockResolvedValue(7);
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("reserves a run, sends every tracked stock with its CURRENT price, stores the result with our price on each pick", async () => {
    const view = await runAnalysis(["growth"], NOW);
    expect(startAnalysis).toHaveBeenCalledWith("2026-09-30", ["growth"], "m", 3);
    const prompt = chat.mock.calls[0][0].user;
    expect(prompt).toContain('"symbol":"NVDA","price":182.5'); // live price wins over the saved 180
    expect(prompt).toContain('"symbol":"AMD","price":150'); // no live price: the saved one
    expect(finishAnalysis).toHaveBeenCalledWith(7, {
      ok: true,
      result: expect.objectContaining({ universe: 2, picks: [expect.objectContaining({ symbol: "NVDA", price: 182.5, rank: 1 })] }),
    });
    expect(view.id).toBe(7);
  });

  it("falls back to saved prices when the live source fails", async () => {
    getLivePrices.mockRejectedValueOnce(new Error("down"));
    await runAnalysis([], NOW);
    expect(chat.mock.calls[0][0].user).toContain('"symbol":"NVDA","price":180');
  });

  it("costs nothing when not configured or when there is nothing to analyse: no run reserved, no provider call", async () => {
    vi.stubEnv("AI_API_KEY", "");
    await expect(runAnalysis([], NOW)).rejects.toMatchObject({ code: "not_configured", message: expect.stringContaining("AI_API_KEY") });
    vi.stubEnv("AI_API_KEY", "k");
    listTrackedSymbols.mockResolvedValueOnce([]);
    await expect(runAnalysis([], NOW)).rejects.toMatchObject({ code: "no_symbols" });
    expect(startAnalysis).not.toHaveBeenCalled();
    expect(chat).not.toHaveBeenCalled();
  });

  it("stops at the daily limit before fetching prices or calling the provider", async () => {
    startAnalysis.mockResolvedValue(null);
    await expect(runAnalysis([], NOW)).rejects.toMatchObject({ code: "limit", message: expect.stringContaining("3 ครั้ง") });
    expect(getLivePrices).not.toHaveBeenCalled();
    expect(chat).not.toHaveBeenCalled();
  });

  it("a failed provider call is recorded as failed (and still counts), with a user-safe message", async () => {
    chat.mockRejectedValueOnce(new AiError("ผู้ให้บริการ AI จำกัดจำนวนครั้ง", "rate_limit", 429));
    await expect(runAnalysis([], NOW)).rejects.toMatchObject({ code: "ai" });
    expect(finishAnalysis).toHaveBeenCalledWith(7, { ok: false, error: "ผู้ให้บริการ AI จำกัดจำนวนครั้ง" });
    chat.mockRejectedValueOnce(new AiError("ช้าไป", "timeout"));
    await expect(runAnalysis([], NOW)).rejects.toMatchObject({ code: "timeout" });
  });

  it("a reply that cannot be used is a parse error, not a crash", async () => {
    chat.mockResolvedValueOnce("sorry, I cannot do that");
    await expect(runAnalysis([], NOW)).rejects.toMatchObject({ code: "parse" });
    expect(finishAnalysis).toHaveBeenCalledWith(7, { ok: false, error: expect.stringContaining("ลองใหม่") });
  });

  it("an unexpected error is recorded and reported without leaking its details", async () => {
    getAnalysis.mockResolvedValueOnce(null);
    const err = await runAnalysis([], NOW).catch((e) => e);
    expect(err).toBeInstanceOf(AnalysisError);
    expect(err.message).toBe("วิเคราะห์ไม่สำเร็จ ลองใหม่อีกครั้ง");
  });
});

describe("runAnalysis: slow live prices", () => {
  it("does not wait for them beyond the budget: saved prices are used and the run still happens", async () => {
    vi.useFakeTimers();
    try {
      getLivePrices.mockImplementationOnce(() => new Promise(() => {})); // never answers
      const run = runAnalysis([], NOW);
      await vi.advanceTimersByTimeAsync(8_001);
      await run;
      expect(chat.mock.calls.at(-1)![0].user).toContain('"symbol":"NVDA","price":180');
    } finally {
      vi.useRealTimers();
    }
  });
});
