import { beforeEach, describe, expect, it, vi } from "vitest";

const claimNotice = vi.fn();
const releaseNotice = vi.fn(async () => {});
const pushText = vi.fn(async () => {});
const listSymbols = vi.fn(async () => ["AMD", "NVDA"]);

vi.mock("@/lib/db/lineUsers", () => ({ claimNotice, releaseNotice, listRecipientIds: vi.fn() }));
vi.mock("@/lib/db/symbols", () => ({ listSymbols }));
vi.mock("@/lib/line/client", () => ({ pushText }));

const USER = `U${"c".repeat(32)}`;

beforeEach(() => {
  vi.clearAllMocks();
  listSymbols.mockResolvedValue(["AMD", "NVDA"]);
});

describe("sendEnabledNotice", () => {
  it("claims first, then pushes exactly one message to that user only", async () => {
    claimNotice.mockResolvedValue(true);
    const { sendEnabledNotice, NOTICE_COOLDOWN_HOURS } = await import("./notify");
    expect(await sendEnabledNotice(USER)).toBe("sent");
    expect(claimNotice).toHaveBeenCalledWith(USER, NOTICE_COOLDOWN_HOURS);
    expect(pushText).toHaveBeenCalledTimes(1);
    const [to, text] = pushText.mock.calls[0] as unknown as [string[], string];
    expect(to).toEqual([USER]);
    expect(text).toContain("AMD, NVDA");
  });

  it("does not push (no quota used) when a notice was sent recently", async () => {
    claimNotice.mockResolvedValue(false);
    const { sendEnabledNotice } = await import("./notify");
    expect(await sendEnabledNotice(USER)).toBe("skipped");
    expect(pushText).not.toHaveBeenCalled();
  });

  it("releases the claim and reports failure (without throwing) when the push fails", async () => {
    claimNotice.mockResolvedValue(true);
    pushText.mockRejectedValueOnce(new Error("429 monthly limit"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { sendEnabledNotice } = await import("./notify");
    await expect(sendEnabledNotice(USER)).resolves.toBe("failed");
    expect(releaseNotice).toHaveBeenCalledWith(USER);
  });

  it("still sends the notice when the stock list cannot be loaded", async () => {
    claimNotice.mockResolvedValue(true);
    listSymbols.mockRejectedValueOnce(new Error("db"));
    const { sendEnabledNotice } = await import("./notify");
    expect(await sendEnabledNotice(USER)).toBe("sent");
  });
});
