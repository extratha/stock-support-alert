import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AiError, chat, chatCompletionsUrl, providerReason, type ChatResult } from "./client";

const ok = (content: unknown) => new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
const status = (code: number, body = "x") => new Response(body, { status: code });
const call = { system: "S", user: "U" };

describe("chat", () => {
  const fetchMock = vi.fn<typeof fetch>();
  beforeEach(() => {
    vi.useFakeTimers(); // a failed call waits before its one retry
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("AI_API_KEY", "sk-secret");
    vi.stubEnv("AI_MODEL", "some/model");
    vi.stubEnv("AI_BASE_URL", "https://api.example.com/v1/");
    vi.stubEnv("AI_TEMPERATURE", "");
    vi.stubEnv("AI_TIMEOUT_SECONDS", "40");
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    fetchMock.mockReset();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  /** Runs a call to the end (jumping over its waits) and returns what it resolved to or the error it threw. */
  const run = async (p: Promise<ChatResult>) => {
    const out = p.then(
      (value) => ({ value, error: undefined as AiError | undefined }),
      (error: AiError) => ({ value: undefined, error }),
    );
    await vi.advanceTimersByTimeAsync(30_000);
    return out;
  };
  const sentModels = () => fetchMock.mock.calls.map(([, init]) => JSON.parse(String(init!.body)).model);

  it("posts an OpenAI-style chat completion with the key in the Authorization header and returns the reply text", async () => {
    fetchMock.mockImplementation(async () => ok("  hello  "));
    const { value } = await run(chat(call));
    expect(value).toEqual({ text: "hello", model: "some/model", skipped: [] });
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("https://api.example.com/v1/chat/completions");
    expect((init!.headers as Record<string, string>).Authorization).toBe("Bearer sk-secret");
    expect(JSON.parse(String(init!.body))).toEqual({ model: "some/model", messages: [{ role: "system", content: "S" }, { role: "user", content: "U" }] });
    expect(String(url)).not.toContain("sk-secret");
  });

  it("sends temperature only when AI_TEMPERATURE is set (some models reject anything but their default)", async () => {
    vi.stubEnv("AI_TEMPERATURE", "0.2");
    fetchMock.mockImplementation(async () => ok("x"));
    await run(chat(call));
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]!.body)).temperature).toBe(0.2);
  });

  it("joins a reply made of text parts", async () => {
    fetchMock.mockImplementation(async () => ok([{ type: "text", text: "a" }, { type: "text", text: "b" }]));
    expect((await run(chat(call))).value?.text).toBe("ab");
  });

  it("refuses to call anything until AI_API_KEY and AI_MODEL are set", async () => {
    vi.stubEnv("AI_API_KEY", "");
    const { error } = await run(chat(call));
    expect(error).toMatchObject({ kind: "config", message: expect.stringContaining("AI_API_KEY") });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("shows the reason the provider gave (Google's one-element array, or an OpenAI-style object) and checks the key first on a 400", async () => {
    fetchMock.mockImplementation(async () =>
      status(400, JSON.stringify([{ error: { code: 400, message: "API key not valid. Please pass a valid API key.", status: "INVALID_ARGUMENT" } }])),
    );
    const { error } = await run(chat(call));
    expect(error!.message).toContain("HTTP 400");
    expect(error!.message).toContain("AI_API_KEY");
    expect(error!.message).toContain('"API key not valid. Please pass a valid API key."');
    fetchMock.mockImplementation(async () => status(404, JSON.stringify({ error: { message: "model `x` not found" } })));
    expect((await run(chat(call))).error!.message).toContain("model `x` not found");
  });

  it("never lets a key through in the reason: the configured key and anything key-shaped are blanked, HTML pages are ignored", () => {
    expect(providerReason(JSON.stringify({ error: { message: "bad key sk-secret and AIzaSyA1234567890abcdefghijklmnopqrstuv" } }), "sk-secret")).toBe("bad key *** and ***");
    expect(providerReason("<html>502 Bad Gateway</html>", "sk-secret")).toBe("");
    expect(providerReason("plain text reason", "sk-secret")).toBe("plain text reason");
    expect(providerReason("x".repeat(500), "")).toBe("***");
    expect(providerReason(JSON.stringify({ error: { message: "word ".repeat(100) } }), "").length).toBeLessThanOrEqual(200);
  });

  it("maps provider failures to short Thai messages that never include the key", async () => {
    fetchMock.mockImplementation(async () => status(401, "bad key sk-secret"));
    const { error } = await run(chat(call));
    expect(error).toBeInstanceOf(AiError);
    expect(error!.message).toContain("AI_API_KEY");
    expect(error!.message).not.toContain("sk-secret");
    fetchMock.mockImplementation(async () => status(429, "slow down"));
    expect((await run(chat(call))).error).toMatchObject({ kind: "rate_limit", status: 429 });
    fetchMock.mockImplementation(async () => status(404, "nope"));
    expect((await run(chat(call))).error!.message).toContain("AI_MODEL");
  });

  it("a timeout stops at once (no time left for another try); an empty reply is its own error", async () => {
    fetchMock.mockRejectedValue(Object.assign(new Error("t"), { name: "TimeoutError" }));
    expect((await run(chat(call))).error).toMatchObject({ kind: "timeout" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fetchMock.mockImplementation(async () => ok("   "));
    expect((await run(chat(call))).error).toMatchObject({ kind: "bad_response" });
    fetchMock.mockImplementation(async () => status(200, "not json"));
    expect((await run(chat(call))).error).toMatchObject({ kind: "bad_response" });
  });

  describe("one model", () => {
    it("tries a provider failure (503 / network) one more time after a pause, and succeeds if it clears", async () => {
      fetchMock.mockImplementationOnce(async () => status(503, "overloaded")).mockImplementation(async () => ok("fine"));
      const { value } = await run(chat(call));
      expect(value?.text).toBe("fine");
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("gives up after that one retry and reports the provider's own message", async () => {
      fetchMock.mockImplementation(async () => status(503, JSON.stringify({ error: { message: "high demand" } })));
      const { error } = await run(chat(call));
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(error).toMatchObject({ kind: "http", status: 503, message: expect.stringContaining("high demand") });
    });

    it("does not retry what a retry cannot fix: bad key or model, quota", async () => {
      for (const code of [400, 401, 403, 404, 429]) {
        fetchMock.mockReset();
        fetchMock.mockImplementation(async () => status(code));
        await run(chat(call));
        expect(fetchMock).toHaveBeenCalledTimes(1);
      }
    });
  });

  describe("several models (AI_MODEL=a,b,c)", () => {
    const models = ["a", "b", "c"];

    it("goes to the next model when the first is out of quota (429), and says which one answered and why the first was skipped", async () => {
      fetchMock.mockImplementationOnce(async () => status(429)).mockImplementation(async () => ok("from b"));
      const { value } = await run(chat({ ...call, models }));
      expect(sentModels()).toEqual(["a", "b"]);
      expect(value).toMatchObject({ text: "from b", model: "b", skipped: [{ model: "a", reason: expect.stringContaining("429") }] });
    });

    it("retires a model that is gone (404) at once, without retrying it", async () => {
      fetchMock.mockImplementationOnce(async () => status(404)).mockImplementation(async () => ok("x"));
      const { value } = await run(chat({ ...call, models }));
      expect(sentModels()).toEqual(["a", "b"]);
      expect(value?.skipped[0].reason).toContain("404");
    });

    it("retries an overloaded model once before moving on", async () => {
      fetchMock.mockImplementationOnce(async () => status(503)).mockImplementationOnce(async () => status(503)).mockImplementation(async () => ok("x"));
      const { value } = await run(chat({ ...call, models }));
      expect(sentModels()).toEqual(["a", "a", "b"]);
      expect(value).toMatchObject({ model: "b", skipped: [{ model: "a", reason: expect.stringContaining("503") }] });
    });

    it("moves on when a model returns an empty reply", async () => {
      fetchMock.mockImplementationOnce(async () => ok("")).mockImplementation(async () => ok("x"));
      expect((await run(chat({ ...call, models }))).value?.model).toBe("b");
    });

    it("stops at once on a wrong key: every other model would fail the same way", async () => {
      fetchMock.mockImplementation(async () => status(403));
      const { error } = await run(chat({ ...call, models }));
      expect(sentModels()).toEqual(["a"]);
      expect(error!.message).toContain("AI_API_KEY");
    });

    it("when none works, lists what happened to each and keeps the last kind", async () => {
      fetchMock.mockImplementationOnce(async () => ok("")).mockImplementation(async () => status(429));
      const { error } = await run(chat({ ...call, models: ["a", "b"] }));
      expect(error!.message).toContain("ลองแล้ว 2 โมเดล");
      expect(error!.message).toContain("a: ไม่มีคำตอบ");
      expect(error!.message).toContain("b: โควตาหมดหรือถูกจำกัด (429)");
      expect(error).toMatchObject({ kind: "rate_limit", status: 429 });
    });

    it("shares one time budget: with little left it stops instead of starting another try", async () => {
      vi.stubEnv("AI_TIMEOUT_SECONDS", "5");
      fetchMock.mockImplementation(async () => status(503));
      const { error } = await run(chat({ ...call, models: ["a", "b"] }));
      // a: 503, wait 2 s, 503; b: 503, wait 2 s -> 1 s left, not enough for another try
      expect(sentModels()).toEqual(["a", "a", "b"]);
      expect(error!.message).toContain("ลองแล้ว 2 โมเดล");
    });
  });
});

describe("chatCompletionsUrl", () => {
  it("requires https, except for a local server", () => {
    expect(chatCompletionsUrl("https://openrouter.ai/api/v1")).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(chatCompletionsUrl("http://localhost:11434/v1")).toBe("http://localhost:11434/v1/chat/completions");
    expect(() => chatCompletionsUrl("http://api.example.com/v1")).toThrow(/https/);
    expect(() => chatCompletionsUrl("not a url")).toThrow(/URL/);
  });
});
