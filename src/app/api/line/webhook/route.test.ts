import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const replyText = vi.fn(async () => {});
const upsertFollower = vi.fn(async () => {});
const ensureFriend = vi.fn(async () => ({ needsProfile: false }));
const syncProfile = vi.fn(async () => true);
const listSymbols = vi.fn(async () => ["AMD", "NVDA"]);
const listTrackedSymbols = vi.fn(async () => [
  { symbol: "NVDA", price: 200, quoteTime: null, levels: [{ tier: "minor", price: 190, method: "ma50" }] },
]);

vi.mock("@/lib/line/client", () => ({ replyText }));
vi.mock("@/lib/db/lineUsers", () => ({ upsertFollower, ensureFriend, deactivateUser: vi.fn() }));
vi.mock("@/lib/jobs/lineProfiles", () => ({ syncProfile }));
vi.mock("@/lib/db/symbols", () => ({ listSymbols, listTrackedSymbols }));

const SECRET = "channel-secret";
const USER = `U${"b".repeat(32)}`;

async function send(events: unknown[]) {
  const raw = JSON.stringify({ events });
  const signature = createHmac("sha256", SECRET).update(raw).digest("base64");
  const { POST } = await import("./route");
  return POST(new Request("http://x/api/line/webhook", { method: "POST", body: raw, headers: { "x-line-signature": signature } }));
}
const source = { type: "user", userId: USER };

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("LINE_CHANNEL_SECRET", SECRET);
  listSymbols.mockResolvedValue(["AMD", "NVDA"]);
});

describe("LINE webhook guide", () => {
  it("sends the usage guide (with tracked symbols) when someone adds the OA", async () => {
    const res = await send([{ type: "follow", replyToken: "tok", source }]);
    expect(res.status).toBe(200);
    expect(upsertFollower).toHaveBeenCalledWith(USER);
    expect(replyText).toHaveBeenCalledTimes(1);
    const [token, text] = replyText.mock.calls[0] as unknown as [string, string];
    expect(token).toBe("tok");
    expect(text).toContain("ยินดีต้อนรับ");
    expect(text).toContain("ขอแนวรับของ AMD");
    expect(text).toContain("หุ้นที่ติดตามอยู่: AMD, NVDA");
  });

  it("still welcomes the user if the symbol list cannot be loaded", async () => {
    listSymbols.mockRejectedValue(new Error("db down"));
    await send([{ type: "follow", replyToken: "tok", source }]);
    const [, text] = replyText.mock.calls[0] as unknown as [string, string];
    expect(text).toContain("ขอแนวรับของ NVDA"); // sample ticker fallback
  });

  it("repeats the guide (without the welcome line) when a friend types วิธีใช้ / help", async () => {
    for (const word of ["วิธีใช้", "help"]) {
      replyText.mockClear();
      await send([{ type: "message", replyToken: "tok", source, message: { type: "text", text: word } }]);
      const [, text] = replyText.mock.calls[0] as unknown as [string, string];
      expect(text).toContain("วิธีใช้ Stock Support Alert");
      expect(text).not.toContain("ยินดีต้อนรับ");
    }
  });

  it("still answers ขอแนวรับ commands and ignores unrelated chat", async () => {
    await send([{ type: "message", replyToken: "t1", source, message: { type: "text", text: "ขอแนวรับของ NVDA" } }]);
    const [, answer] = replyText.mock.calls[0] as unknown as [string, string[]];
    expect(answer.join("\n")).toContain("NVDA — $200.00");

    replyText.mockClear();
    await send([{ type: "message", replyToken: "t2", source, message: { type: "text", text: "สวัสดี" } }]);
    expect(replyText).not.toHaveBeenCalled();
  });

  it("rejects requests that LINE did not sign", async () => {
    const { POST } = await import("./route");
    const res = await POST(new Request("http://x", { method: "POST", body: "{}", headers: { "x-line-signature": "nope" } }));
    expect(res.status).toBe(401);
    expect(replyText).not.toHaveBeenCalled();
  });
});
