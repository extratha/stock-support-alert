import { afterEach, describe, expect, it, vi } from "vitest";
import { config } from "./config";

describe("config.alertTiers", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("alerts on the major tier only unless told otherwise", () => {
    vi.stubEnv("ALERT_TIERS", "");
    expect(config.alertTiers()).toEqual(["major"]);
  });

  it("reads a comma list and ignores unknown names", () => {
    vi.stubEnv("ALERT_TIERS", "minor, major,bogus");
    expect(config.alertTiers()).toEqual(["minor", "major"]);
    vi.stubEnv("ALERT_TIERS", "bogus");
    expect(config.alertTiers()).toEqual(["major"]);
  });
});

describe("config.ai.models", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("AI_MODEL is one model or a comma list: trimmed, empty entries and duplicates dropped, first = default", () => {
    vi.stubEnv("AI_MODEL", " gemini-a , gemini-b,,gemini-a ,");
    expect(config.ai.models()).toEqual(["gemini-a", "gemini-b"]);
    expect(config.ai.model()).toBe("gemini-a");
    vi.stubEnv("AI_MODEL", "only-one");
    expect(config.ai.models()).toEqual(["only-one"]);
  });

  it("counts as not set when there is no model name at all", () => {
    vi.stubEnv("AI_API_KEY", "k");
    for (const raw of ["", "  ", ",,"]) {
      vi.stubEnv("AI_MODEL", raw);
      expect(config.ai.models()).toEqual([]);
      expect(config.ai.model()).toBe("");
      expect(config.ai.missing()).toEqual(["AI_MODEL"]);
    }
  });
});

describe("config.ai.timeoutMs", () => {
  afterEach(() => vi.unstubAllEnvs());
  it("defaults to the most that fits Vercel's 300 s (280 s), and is clamped to 5-280 s", () => {
    vi.stubEnv("AI_TIMEOUT_SECONDS", "");
    expect(config.ai.timeoutMs()).toBe(280_000);
    vi.stubEnv("AI_TIMEOUT_SECONDS", "900");
    expect(config.ai.timeoutMs()).toBe(280_000);
    vi.stubEnv("AI_TIMEOUT_SECONDS", "1");
    expect(config.ai.timeoutMs()).toBe(5_000);
    vi.stubEnv("AI_TIMEOUT_SECONDS", "90");
    expect(config.ai.timeoutMs()).toBe(90_000);
  });
});
