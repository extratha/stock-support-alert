import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AnalysisView } from "@/lib/analysis/types";

const startAnalysis = vi.fn<(...a: unknown[]) => Promise<number | null>>(async () => 7);
const finishAnalysis = vi.fn(async () => {});
const cancelAnalysis = vi.fn(async () => {});
const getAnalysis = vi.fn(async (): Promise<AnalysisView | null> => ({
  id: 7, createdAt: "2026-09-30T14:00:00.000Z", model: "m", goals: ["growth"], summary: "s", picks: [], caveats: [], universe: 2, skipped: [],
}));
vi.mock("@/lib/db/analyses", () => ({ startAnalysis, finishAnalysis, cancelAnalysis, getAnalysis }));
vi.mock("@/lib/db/profiles", () => ({ listProfiles: vi.fn(async () => []) }));
vi.mock("@/lib/db/supports", () => ({ listSupportTests: vi.fn(async () => []) }));
const listTrackedSymbols = vi.fn(async () => [
  { symbol: "NVDA", logoVersion: null, price: 180, quoteTime: null, asOf: null, refClose: 180, levels: [] },
  { symbol: "AMD", logoVersion: null, price: 150, quoteTime: null, asOf: null, refClose: 150, levels: [] },
]);
vi.mock("@/lib/db/symbols", () => ({ listTrackedSymbols }));
const getLivePrices = vi.fn(async () => ({ prices: { NVDA: { price: 182.5, asOf: null, source: "finnhub" } }, errors: {} }));
vi.mock("./livePrices", () => ({ getLivePrices }));
const reply = (model = "m", skipped: { model: string; reason: string }[] = []) => ({
  text: JSON.stringify({ summary: "s", picks: [{ symbol: "NVDA", rank: 1, reasons: ["r"], risks: ["k"], entryNote: "n" }] }),
  model,
  skipped,
});
const chat = vi.fn<(a: { system: string; user: string; models?: string[] }) => Promise<{ text: string; model: string; skipped: { model: string; reason: string }[] }>>(async () => reply());
vi.mock("@/lib/ai/client", async (orig) => ({ ...(await orig<typeof import("@/lib/ai/client")>()), chat }));

const { runAnalysis, manualPrompt, AnalysisError } = await import("./analysis");
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
    const view = await runAnalysis(["growth"], {}, NOW);
    expect(startAnalysis).toHaveBeenCalledWith("2026-09-30", ["growth"], "m", 3);
    const prompt = chat.mock.calls[0][0].user;
    expect(prompt).toContain('"symbol":"NVDA","price":182.5'); // live price wins over the saved 180
    expect(prompt).toContain('"symbol":"AMD","price":150'); // no live price: the saved one
    expect(finishAnalysis).toHaveBeenCalledWith(7, {
      ok: true,
      model: "m",
      result: expect.objectContaining({ universe: 2, skipped: [], picks: [expect.objectContaining({ symbol: "NVDA", price: 182.5, rank: 1 })] }),
    });
    expect(view.id).toBe(7);
  });

  it("falls back to saved prices when the live source fails", async () => {
    getLivePrices.mockRejectedValueOnce(new Error("down"));
    await runAnalysis([], {}, NOW);
    expect(chat.mock.calls[0][0].user).toContain('"symbol":"NVDA","price":180');
  });

  it("costs nothing when not configured or when there is nothing to analyse: no run reserved, no provider call", async () => {
    vi.stubEnv("AI_API_KEY", "");
    await expect(runAnalysis([], {}, NOW)).rejects.toMatchObject({ code: "not_configured", message: expect.stringContaining("AI_API_KEY") });
    vi.stubEnv("AI_API_KEY", "k");
    listTrackedSymbols.mockResolvedValueOnce([]);
    await expect(runAnalysis([], {}, NOW)).rejects.toMatchObject({ code: "no_symbols" });
    expect(startAnalysis).not.toHaveBeenCalled();
    expect(chat).not.toHaveBeenCalled();
  });

  it("stops at the daily limit before fetching prices or calling the provider", async () => {
    startAnalysis.mockResolvedValue(null);
    await expect(runAnalysis([], {}, NOW)).rejects.toMatchObject({ code: "limit", message: expect.stringContaining("3 ครั้ง") });
    expect(getLivePrices).not.toHaveBeenCalled();
    expect(chat).not.toHaveBeenCalled();
  });

  it.each([
    ["rate limit", new AiError("ผู้ให้บริการ AI จำกัดจำนวนครั้ง", "rate_limit", 429), "ai"],
    ["overloaded", new AiError("ผู้ให้บริการ AI ตอบ error (HTTP 503)", "http", 503), "ai"],
    ["timeout", new AiError("ช้าไป", "timeout"), "timeout"],
    ["empty reply", new AiError("AI ไม่ได้ส่งคำตอบกลับมา", "bad_response"), "ai"],
  ])("an error (%s) never uses up the day: the reserved run is given back, with a user-safe message", async (_, err, code) => {
    chat.mockRejectedValueOnce(err);
    await expect(runAnalysis([], {}, NOW)).rejects.toMatchObject({ code, message: err.message });
    expect(cancelAnalysis).toHaveBeenCalledWith(7);
    expect(finishAnalysis).not.toHaveBeenCalled();
  });

  it("the chosen model goes first and the others stay as fallbacks; the run is reserved under the chosen one", async () => {
    vi.stubEnv("AI_MODEL", "a, b ,c");
    await runAnalysis([], { model: "b" }, NOW);
    expect(startAnalysis).toHaveBeenCalledWith("2026-09-30", [], "b", 3);
    expect(chat.mock.calls[0][0].models).toEqual(["b", "a", "c"]);
    await runAnalysis([], {}, NOW);
    expect(chat.mock.calls[1][0].models).toEqual(["a", "b", "c"]);
  });

  it("only models listed in AI_MODEL can be chosen, and nothing is reserved for a bad choice", async () => {
    vi.stubEnv("AI_MODEL", "a,b");
    await expect(runAnalysis([], { model: "gpt-expensive" }, NOW)).rejects.toMatchObject({ code: "bad_request" });
    expect(startAnalysis).not.toHaveBeenCalled();
    expect(chat).not.toHaveBeenCalled();
  });

  it("stores the model that actually answered and the ones it had to skip", async () => {
    vi.stubEnv("AI_MODEL", "a,b");
    chat.mockResolvedValueOnce(reply("b", [{ model: "a", reason: "โควตาหมดหรือถูกจำกัด (429)" }]));
    await runAnalysis([], {}, NOW);
    expect(finishAnalysis).toHaveBeenCalledWith(7, {
      ok: true,
      model: "b",
      result: expect.objectContaining({ skipped: [{ model: "a", reason: "โควตาหมดหรือถูกจำกัด (429)" }] }),
    });
  });

  it("a reply that cannot be used is a parse error, not a crash", async () => {
    chat.mockResolvedValueOnce({ text: "sorry, I cannot do that", model: "m", skipped: [] });
    await expect(runAnalysis([], {}, NOW)).rejects.toMatchObject({ code: "parse" });
    expect(cancelAnalysis).toHaveBeenCalledWith(7); // not counted either
    expect(finishAnalysis).not.toHaveBeenCalled();
  });

  it("an unexpected error is reported without leaking its details, and not counted", async () => {
    getAnalysis.mockResolvedValueOnce(null);
    const err = await runAnalysis([], {}, NOW).catch((e) => e);
    expect(err).toBeInstanceOf(AnalysisError);
    expect(err.message).toBe("วิเคราะห์ไม่สำเร็จ ลองใหม่อีกครั้ง");
    expect(cancelAnalysis).toHaveBeenCalledWith(7);
  });
});

describe("runAnalysis: slow live prices", () => {
  it("does not wait for them beyond the budget: saved prices are used and the run still happens", async () => {
    vi.useFakeTimers();
    try {
      getLivePrices.mockImplementationOnce(() => new Promise(() => {})); // never answers
      const run = runAnalysis([], {}, NOW);
      await vi.advanceTimersByTimeAsync(8_001);
      await run;
      expect(chat.mock.calls.at(-1)![0].user).toContain('"symbol":"NVDA","price":180');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("manualPrompt", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
  });

  it("is the rules plus the same data with current prices, and needs no AI settings, reserves nothing, calls no AI", async () => {
    vi.stubEnv("AI_API_KEY", "");
    vi.stubEnv("AI_MODEL", "");
    const text = await manualPrompt(["dividend"], NOW);
    expect(text).toMatch(/Answer in readable Thai/);
    expect(text).toContain('"symbol":"NVDA","price":182.5');
    expect(text).toContain("Dividend income");
    expect(startAnalysis).not.toHaveBeenCalled();
    expect(chat).not.toHaveBeenCalled();
  });

  it("says so when there is nothing to analyse", async () => {
    listTrackedSymbols.mockResolvedValueOnce([]);
    await expect(manualPrompt([], NOW)).rejects.toMatchObject({ code: "no_symbols" });
  });
});
