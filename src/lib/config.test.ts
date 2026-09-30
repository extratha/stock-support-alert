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
