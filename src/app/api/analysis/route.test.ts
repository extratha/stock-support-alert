import { beforeEach, describe, expect, it, vi } from "vitest";

const runAnalysis = vi.fn();
const runsOnDay = vi.fn(async () => 2);
class AnalysisError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
  }
}
vi.mock("@/lib/jobs/analysis", () => ({ runAnalysis, AnalysisError }));
vi.mock("@/lib/db/analyses", () => ({ runsOnDay }));

const { POST } = await import("./route");
const post = (body: unknown) => POST(new Request("http://x/api/analysis", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) }));

describe("POST /api/analysis", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("runs the analysis for the chosen goals and returns it with today's usage", async () => {
    runAnalysis.mockResolvedValue({ id: 1 });
    const res = await post({ goals: ["dividend", "growth"] });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ analysis: { id: 1 }, used: 2 });
    expect(runAnalysis).toHaveBeenCalledWith(["growth", "dividend"]);
  });

  it("no goals means a balanced view", async () => {
    runAnalysis.mockResolvedValue({ id: 1 });
    expect((await post({})).status).toBe(200);
    expect(runAnalysis).toHaveBeenCalledWith([]);
  });

  it("rejects unknown goals and bad bodies before anything is spent", async () => {
    expect((await post({ goals: ["buy everything"] })).status).toBe(400);
    expect((await post({ goals: "growth" })).status).toBe(400);
    expect((await post("not json")).status).toBe(400);
    expect((await post("null")).status).toBe(400);
    expect(runAnalysis).not.toHaveBeenCalled();
  });

  it.each([
    ["not_configured", 503],
    ["no_symbols", 409],
    ["limit", 429],
    ["timeout", 504],
    ["ai", 502],
    ["parse", 502],
  ])("maps %s to HTTP %i with the message and usage", async (code, status) => {
    runAnalysis.mockRejectedValue(new AnalysisError("ข้อความ", code));
    const res = await post({ goals: [] });
    expect(res.status).toBe(status);
    expect(await res.json()).toEqual({ error: "ข้อความ", used: 2 });
  });

  it("an unexpected error is a plain 500 with no details", async () => {
    runAnalysis.mockRejectedValue(new Error("secret internals"));
    const res = await post({ goals: [] });
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain("secret internals");
  });

  it("still answers when today's usage cannot be read", async () => {
    runsOnDay.mockRejectedValueOnce(new Error("db"));
    runAnalysis.mockResolvedValue({ id: 1 });
    expect(await (await post({ goals: [] })).json()).toEqual({ analysis: { id: 1 }, used: null });
  });
});
