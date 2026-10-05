import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AiError, chat, chatCompletionsUrl } from "./client";

const ok = (content: unknown) => new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });

describe("chat", () => {
  const fetchMock = vi.fn<typeof fetch>();
  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("AI_API_KEY", "sk-secret");
    vi.stubEnv("AI_MODEL", "some/model");
    vi.stubEnv("AI_BASE_URL", "https://api.example.com/v1/");
    vi.stubEnv("AI_TEMPERATURE", "");
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    fetchMock.mockReset();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("posts an OpenAI-style chat completion with the key in the Authorization header and returns the reply text", async () => {
    fetchMock.mockResolvedValue(ok("  hello  "));
    expect(await chat({ system: "S", user: "U" })).toBe("hello");
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("https://api.example.com/v1/chat/completions");
    expect((init!.headers as Record<string, string>).Authorization).toBe("Bearer sk-secret");
    const body = JSON.parse(String(init!.body));
    expect(body).toEqual({ model: "some/model", messages: [{ role: "system", content: "S" }, { role: "user", content: "U" }] });
    expect(String(url)).not.toContain("sk-secret");
  });

  it("sends temperature only when AI_TEMPERATURE is set (some models reject anything but their default)", async () => {
    vi.stubEnv("AI_TEMPERATURE", "0.2");
    fetchMock.mockResolvedValue(ok("x"));
    await chat({ system: "S", user: "U" });
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]!.body)).temperature).toBe(0.2);
  });

  it("joins a reply made of text parts", async () => {
    fetchMock.mockResolvedValue(ok([{ type: "text", text: "a" }, { type: "text", text: "b" }]));
    expect(await chat({ system: "S", user: "U" })).toBe("ab");
  });

  it("refuses to call anything until AI_API_KEY and AI_MODEL are set", async () => {
    vi.stubEnv("AI_API_KEY", "");
    await expect(chat({ system: "S", user: "U" })).rejects.toMatchObject({ kind: "config", message: expect.stringContaining("AI_API_KEY") });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("maps provider failures to short Thai messages that never include the provider's text or the key", async () => {
    fetchMock.mockResolvedValue(new Response("bad key sk-secret", { status: 401 }));
    const err = await chat({ system: "S", user: "U" }).catch((e) => e);
    expect(err).toBeInstanceOf(AiError);
    expect(err.message).toContain("AI_API_KEY");
    expect(err.message).not.toContain("sk-secret");
    fetchMock.mockResolvedValue(new Response("slow down", { status: 429 }));
    await expect(chat({ system: "S", user: "U" })).rejects.toMatchObject({ kind: "rate_limit" });
    fetchMock.mockResolvedValue(new Response("nope", { status: 404 }));
    await expect(chat({ system: "S", user: "U" })).rejects.toMatchObject({ message: expect.stringContaining("AI_MODEL") });
    fetchMock.mockResolvedValue(new Response("boom", { status: 500 }));
    await expect(chat({ system: "S", user: "U" })).rejects.toMatchObject({ kind: "http", status: 500 });
  });

  it("reports a timeout and an empty reply as such", async () => {
    fetchMock.mockRejectedValue(Object.assign(new Error("t"), { name: "TimeoutError" }));
    await expect(chat({ system: "S", user: "U" })).rejects.toMatchObject({ kind: "timeout" });
    fetchMock.mockResolvedValue(ok("   "));
    await expect(chat({ system: "S", user: "U" })).rejects.toMatchObject({ kind: "bad_response" });
    fetchMock.mockResolvedValue(new Response("not json", { status: 200 }));
    await expect(chat({ system: "S", user: "U" })).rejects.toMatchObject({ kind: "bad_response" });
  });

  it("makes no retry: one failed call is one call", async () => {
    fetchMock.mockResolvedValue(new Response("x", { status: 500 }));
    await chat({ system: "S", user: "U" }).catch(() => {});
    expect(fetchMock).toHaveBeenCalledTimes(1);
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
