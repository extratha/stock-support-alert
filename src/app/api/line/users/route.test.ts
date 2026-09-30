import { beforeEach, describe, expect, it, vi } from "vitest";

const setNotify = vi.fn();
const setLabel = vi.fn();
vi.mock("@/lib/db/lineUsers", () => ({ setNotify, setLabel }));

const USER = `U${"a".repeat(32)}`;
const call = async (userId: string, body: unknown) => {
  const { PATCH } = await import("./[userId]/route");
  const res = await PATCH(
    new Request("http://x/api/line/users/" + userId, { method: "PATCH", body: JSON.stringify(body) }),
    { params: Promise.resolve({ userId }) },
  );
  return { status: res.status, body: (await res.json()) as { error?: string; ok?: boolean } };
};

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.MAX_PUSH_RECIPIENTS;
  setNotify.mockResolvedValue("ok");
  setLabel.mockResolvedValue(true);
});

describe("PATCH /api/line/users/[userId]", () => {
  it("rejects a malformed userId and empty / wrong-typed bodies", async () => {
    expect((await call("not-a-user", { notify: true })).status).toBe(400);
    expect((await call(USER, {})).status).toBe(400);
    expect((await call(USER, { notify: "yes" })).status).toBe(400);
    expect((await call(USER, { label: 5 })).status).toBe(400);
    expect(setNotify).not.toHaveBeenCalled();
  });

  it("enables push with the configured cap (default 5) and reports success", async () => {
    const r = await call(USER, { notify: true });
    expect(r).toEqual({ status: 200, body: { ok: true } });
    expect(setNotify).toHaveBeenCalledWith(USER, true, 5);
  });

  it("honours MAX_PUSH_RECIPIENTS", async () => {
    process.env.MAX_PUSH_RECIPIENTS = "2";
    await call(USER, { notify: true });
    expect(setNotify).toHaveBeenCalledWith(USER, true, 2);
  });

  it("answers 409 with a clear message when the cap is reached", async () => {
    setNotify.mockResolvedValue("limit");
    const r = await call(USER, { notify: true });
    expect(r.status).toBe(409);
    expect(r.body.error).toContain("สูงสุด 5 คน");
  });

  it("answers 409 for someone who is no longer a friend, 404 for an unknown user", async () => {
    setNotify.mockResolvedValue("inactive");
    expect((await call(USER, { notify: true })).status).toBe(409);
    setNotify.mockResolvedValue("not_found");
    expect((await call(USER, { notify: true })).status).toBe(404);
  });

  it("trims labels, stores empty as null and rejects overly long ones", async () => {
    await call(USER, { label: "  extratha  " });
    expect(setLabel).toHaveBeenLastCalledWith(USER, "extratha");
    await call(USER, { label: "   " });
    expect(setLabel).toHaveBeenLastCalledWith(USER, null);
    const tooLong = await call(USER, { label: "x".repeat(41) });
    expect(tooLong.status).toBe(400);
  });
});
