import { beforeEach, describe, expect, it, vi } from "vitest";

const setNotify = vi.fn();
const setLabel = vi.fn();
const setPublicPhoto = vi.fn();
const sendEnabledNotice = vi.fn();
vi.mock("@/lib/db/lineUsers", () => ({ setNotify, setLabel, setPublicPhoto }));
vi.mock("@/lib/jobs/notify", () => ({ sendEnabledNotice }));

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
  setNotify.mockResolvedValue("enabled");
  setLabel.mockResolvedValue(true);
  setPublicPhoto.mockResolvedValue(true);
  sendEnabledNotice.mockResolvedValue("sent");
});

describe("PATCH /api/line/users/[userId]", () => {
  it("switches the public profile picture on and off, and checks the type", async () => {
    expect((await call(USER, { publicPhoto: true })).status).toBe(200);
    expect(setPublicPhoto).toHaveBeenLastCalledWith(USER, true);
    expect((await call(USER, { publicPhoto: false })).status).toBe(200);
    expect(setPublicPhoto).toHaveBeenLastCalledWith(USER, false);
    expect((await call(USER, { publicPhoto: "yes" })).status).toBe(400);
    setPublicPhoto.mockResolvedValueOnce(false);
    expect((await call(USER, { publicPhoto: true })).status).toBe(404);
    expect(setNotify).not.toHaveBeenCalled();
    expect(sendEnabledNotice).not.toHaveBeenCalled();
  });

  it("rejects a malformed userId and empty / wrong-typed bodies", async () => {
    expect((await call("not-a-user", { notify: true })).status).toBe(400);
    expect((await call(USER, {})).status).toBe(400);
    expect((await call(USER, { notify: "yes" })).status).toBe(400);
    expect((await call(USER, { label: 5 })).status).toBe(400);
    expect(setNotify).not.toHaveBeenCalled();
  });

  it("enables push with the configured cap (default 5) and reports success", async () => {
    const r = await call(USER, { notify: true });
    expect(r.status).toBe(200);
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

describe("the LINE notice when push is switched ON", () => {
  it("is sent only on an off -> on change, and reported in the response", async () => {
    const r = await call(USER, { notify: true });
    expect(sendEnabledNotice).toHaveBeenCalledWith(USER);
    expect(r.body).toEqual({ ok: true, notice: "sent" });
  });

  it("is not sent when nothing changed, when turning off, or when the request is refused", async () => {
    for (const result of ["unchanged", "disabled", "limit", "inactive", "not_found"]) {
      setNotify.mockResolvedValue(result);
      await call(USER, { notify: result !== "disabled" });
    }
    await call(USER, { label: "just a label" });
    expect(sendEnabledNotice).not.toHaveBeenCalled();
  });

  it("does not fail the request when the notice could not be delivered", async () => {
    sendEnabledNotice.mockResolvedValue("failed");
    const r = await call(USER, { notify: true });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ ok: true, notice: "failed" });
  });
});
