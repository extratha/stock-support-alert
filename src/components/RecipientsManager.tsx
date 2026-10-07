"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { apiFetch } from "@/lib/apiFetch";
import type { RecipientRow } from "@/lib/recipients";
import { RefreshIcon } from "./icons";
import { Spinner } from "./Spinner";

function Avatar({ user }: { user: RecipientRow }) {
  if (user.pictureUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- small LINE CDN avatar, no optimisation needed
      <img
        src={user.pictureUrl}
        alt=""
        width={44}
        height={44}
        loading="lazy"
        referrerPolicy="no-referrer"
        className="size-11 shrink-0 rounded-full object-cover ring-1 ring-border"
      />
    );
  }
  const initial = (user.label || user.displayName || "").trim().charAt(0).toUpperCase();
  return (
    <span aria-hidden="true" className="grid size-11 shrink-0 place-items-center rounded-full bg-elevated text-base font-semibold text-muted ring-1 ring-border">
      {initial || (
        // no name to show (a visitor, or not fetched yet): a plain silhouette
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} className="size-5">
          <circle cx="12" cy="8" r="4" />
          <path d="M4 21a8 8 0 0 1 16 0" />
        </svg>
      )}
    </span>
  );
}

function LabelField({ user, disabled, onSave }: { user: RecipientRow; disabled: boolean; onSave: (label: string) => void }) {
  const [value, setValue] = useState(user.label ?? "");
  const commit = () => {
    if (value.trim() !== (user.label ?? "")) onSave(value);
  };
  return (
    <input
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
      maxLength={40}
      disabled={disabled}
      placeholder="ชื่อเรียก (เช่น LINE ID)"
      aria-label={`ชื่อเรียกของ ${user.displayName ?? user.idLabel}`}
      className="min-h-9 w-full max-w-xs rounded-md border border-border bg-background/60 px-2 text-sm placeholder:text-muted focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/40 disabled:opacity-60"
    />
  );
}

function Switch({ on, label, disabled, busy, title, onClick }: { on: boolean; label: string; disabled: boolean; busy?: boolean; title?: string; onClick: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      title={title}
      onClick={onClick}
      className={`relative h-7 w-12 shrink-0 cursor-pointer rounded-full ring-1 transition-colors duration-200 disabled:cursor-not-allowed disabled:opacity-50 ${
        on ? "bg-primary/90 ring-primary" : "bg-elevated ring-border"
      }`}
    >
      <span
        className={`absolute left-0.5 top-0.5 grid size-6 place-items-center rounded-full bg-foreground transition-transform duration-200 ${on ? "translate-x-5" : ""}`}
      >
        {busy && <Spinner className="size-3.5 text-background" />}
      </span>
    </button>
  );
}

const FriendBadge = ({ active }: { active: boolean }) => (
  <span className={`rounded-full px-2 py-0.5 text-xs ring-1 ${active ? "bg-success/12 text-success ring-success/30" : "bg-elevated text-muted ring-border"}`}>
    {active ? "เป็นเพื่อน" : "เลิกเป็นเพื่อนแล้ว"}
  </span>
);

/** The public, read-only list: proof that the LINE integration works, without anyone's personal data. */
function ReadOnlyList({ users, max }: { users: RecipientRow[]; max: number }) {
  const enabled = users.filter((u) => u.active && u.notify).length;
  return (
    <div className="space-y-4">
      <p className="text-sm">
        รับแจ้งเตือนอยู่ <strong className="font-mono text-primary">{enabled}/{max}</strong> คน
      </p>
      {users.length === 0 ? (
        <div className="surface p-8 text-center text-muted">ยังไม่มีผู้รับ</div>
      ) : (
        <ul className="surface divide-y divide-border">
          {users.map((u, i) => (
            <li key={u.key} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
              <Avatar user={u} />
              <div className="min-w-0 flex-1 basis-56 space-y-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="font-medium">ผู้รับ #{i + 1}</span>
                  <FriendBadge active={u.active} />
                </div>
                <p className="text-xs text-muted">
                  {u.profileFetched ? (
                    <>
                      <span className="text-success">✓ ดึงชื่อและรูปโปรไฟล์จาก LINE แล้ว</span>
                      {u.pictureUrl ? " · แสดงรูปจริงโดยได้รับอนุญาต" : " · ซ่อนชื่อและรูปเพื่อความเป็นส่วนตัว"}
                    </>
                  ) : (
                    "ยังไม่ได้ดึงโปรไฟล์จาก LINE"
                  )}
                </p>
                <p className="font-mono text-xs text-muted">
                  {u.idLabel} · แอดเมื่อ {u.followedAtLabel}
                </p>
              </div>
              <span className={`text-sm ${u.notify ? "text-primary" : "text-muted"}`}>{u.notify ? "รับแจ้งเตือน" : "ไม่รับแจ้งเตือน"}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-muted">
        ระบบเก็บ LINE user id ชื่อ และรูปโปรไฟล์ของเพื่อนที่แอด Official Account เพื่อส่งแจ้งเตือน — หน้าสาธารณะไม่แสดงข้อมูลเหล่านี้
      </p>
    </div>
  );
}

interface ApiBody {
  error?: string;
  notice?: "sent" | "skipped" | "failed";
}
type Message = { kind: "ok" | "warn" | "error"; text: string };

const MESSAGE_STYLE: Record<Message["kind"], string> = { ok: "text-success", warn: "text-warning", error: "text-danger" };

/** What to tell the owner after switching alerts ON (the server also pushes a notice to the user). */
function enabledMessage({ notice }: ApiBody): Message {
  if (notice === "sent") return { kind: "ok", text: "เปิดการแจ้งเตือนแล้ว และส่งข้อความแจ้งผู้รับทาง LINE แล้ว" };
  if (notice === "skipped") {
    return { kind: "ok", text: "เปิดการแจ้งเตือนแล้ว (เพิ่งแจ้งผู้รับไปภายใน 24 ชั่วโมง จึงไม่ส่งข้อความซ้ำ)" };
  }
  if (notice === "failed") {
    return { kind: "warn", text: "เปิดการแจ้งเตือนแล้ว แต่ส่งข้อความแจ้งผู้รับไม่สำเร็จ (โควตา push ของ LINE อาจเต็ม)" };
  }
  return { kind: "ok", text: "เปิดการแจ้งเตือนแล้ว" };
}

export function RecipientsManager({ users, max, readOnly = false }: { users: RecipientRow[]; max: number; readOnly?: boolean }) {
  if (readOnly) return <ReadOnlyList users={users} max={max} />;
  return <Manager users={users} max={max} />;
}

function Manager({ users: serverUsers, max }: { users: RecipientRow[]; max: number }) {
  // Local copy of the list so a switch moves the instant it is clicked (optimistic update),
  // instead of waiting for the server round-trip + page refresh. It is replaced by fresh
  // server data whenever that arrives ("adjust state while rendering" pattern).
  const [seenServerUsers, setSeenServerUsers] = useState(serverUsers);
  const [users, setUsers] = useState(serverUsers);
  if (serverUsers !== seenServerUsers) {
    setSeenServerUsers(serverUsers);
    setUsers(serverUsers);
  }

  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null); // key of the row being updated, or "refresh"
  const [message, setMessage] = useState<Message | null>(null);

  const enabled = users.filter((u) => u.active && u.notify).length;
  const full = enabled >= max;

  async function request(key: string, url: string, init: RequestInit, ok: string | ((body: ApiBody) => Message)): Promise<boolean> {
    setBusy(key);
    setMessage(null);
    try {
      const res = await apiFetch(url, init);
      const body = (await res.json().catch(() => ({}))) as ApiBody;
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      setMessage(typeof ok === "string" ? { kind: "ok", text: ok } : ok(body));
      router.refresh(); // sync with the server in the background; the UI is already up to date
      return true;
    } catch (err) {
      setMessage({ kind: "error", text: err instanceof Error ? err.message : "เกิดข้อผิดพลาด" });
      return false;
    } finally {
      setBusy(null);
    }
  }

  // for the owner, `key` is the LINE user id
  const patch = (userId: string, payload: { notify?: boolean; label?: string; publicPhoto?: boolean }, ok: string | ((body: ApiBody) => Message)) =>
    request(
      userId,
      `/api/line/users/${userId}`,
      { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) },
      ok,
    );

  /** Flip a switch immediately; put it back if the server refuses (cap reached, friend left, network). */
  async function flip(u: RecipientRow, field: "notify" | "publicPhoto", okText: string | ((body: ApiBody) => Message)) {
    const next = !u[field];
    const set = (value: boolean) => setUsers((list) => list.map((x) => (x.key === u.key ? { ...x, [field]: value } : x)));
    set(next);
    if (!(await patch(u.key, { [field]: next }, okText))) set(u[field]);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm">
          รับแจ้งเตือนอยู่{" "}
          <strong className={`font-mono ${full ? "text-warning" : "text-primary"}`}>
            {enabled}/{max}
          </strong>{" "}
          คน
          {full && <span className="text-muted"> — ครบแล้ว ปิดของคนอื่นก่อนถึงจะเปิดเพิ่มได้</span>}
        </p>
        <button
          onClick={() => request("refresh", "/api/line/users/refresh", { method: "POST" }, "อัปเดตชื่อและรูปจาก LINE แล้ว")}
          disabled={busy !== null}
          className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-border bg-card px-4 text-sm transition-colors duration-150 hover:border-primary/50 hover:text-primary disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy === "refresh" ? <Spinner /> : <RefreshIcon />}
          อัปเดตชื่อจาก LINE
        </button>
      </div>

      <div aria-live="polite" className="min-h-5">
        {message && <p className={`text-sm ${MESSAGE_STYLE[message.kind]}`}>{message.text}</p>}
      </div>

      {users.length === 0 ? (
        <div className="surface p-8 text-center text-muted">ยังไม่มีเพื่อน — ให้ผู้รับแอด LINE OA ก่อน</div>
      ) : (
        <ul className="surface divide-y divide-border">
          {users.map((u) => {
            const name = u.displayName ?? "ยังไม่ทราบชื่อ";
            const rowBusy = busy === u.key;
            const cannotEnable = !u.notify && (full || !u.active);
            return (
              <li key={u.key} className="flex flex-wrap items-center gap-x-4 gap-y-3 px-4 py-3">
                <Avatar user={u} />
                <div className="min-w-0 flex-1 basis-56 space-y-1.5">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className={`truncate font-medium ${u.displayName ? "" : "text-muted"}`}>{name}</span>
                    <FriendBadge active={u.active} />
                  </div>
                  <LabelField key={u.label ?? ""} user={u} disabled={busy !== null} onSave={(label) => patch(u.key, { label }, "บันทึกชื่อเรียกแล้ว")} />
                  <p className="font-mono text-xs text-muted">
                    {u.idLabel} · แอดเมื่อ {u.followedAtLabel}
                  </p>
                </div>

                <div className="flex flex-col items-end gap-2">
                  <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm">
                    <span className={u.notify ? "text-primary" : "text-muted"}>{u.notify ? "รับแจ้งเตือน" : "ไม่รับแจ้งเตือน"}</span>
                    <Switch
                      on={u.notify}
                      label={`รับแจ้งเตือนของ ${name}`}
                      disabled={busy !== null || cannotEnable}
                      busy={rowBusy}
                      title={!u.active ? "เลิกเป็นเพื่อนแล้ว" : cannotEnable ? `ครบ ${max} คนแล้ว` : undefined}
                      onClick={() => flip(u, "notify", u.notify ? "ปิดการแจ้งเตือนแล้ว" : enabledMessage)}
                    />
                  </label>
                  <label className="flex cursor-pointer items-center gap-3 text-xs text-muted">
                    <span>แสดงรูปบนหน้าสาธารณะ</span>
                    <Switch
                      on={u.publicPhoto}
                      label={`แสดงรูปของ ${name} บนหน้าสาธารณะ`}
                      disabled={busy !== null || !u.pictureUrl}
                      title={!u.pictureUrl ? "ยังไม่มีรูปโปรไฟล์" : "เปิดเฉพาะบัญชีของคุณเอง หรือคนที่อนุญาตแล้ว"}
                      onClick={() => flip(u, "publicPhoto", u.publicPhoto ? "ซ่อนรูปจากหน้าสาธารณะแล้ว" : "แสดงรูปบนหน้าสาธารณะแล้ว")}
                    />
                  </label>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <p className="text-xs text-muted">
        เมื่อเปิดรับแจ้งเตือน ระบบจะส่งข้อความแจ้งผู้รับทาง LINE 1 ข้อความ (นับโควตา push) ไม่เกิน 1 ครั้งต่อคนต่อ 24 ชั่วโมง
        <br />
        หน้าสาธารณะ (ผู้เยี่ยมชมที่ไม่ได้เข้าสู่ระบบ) ไม่เห็นชื่อ ชื่อเรียก หรือ user id ของใครเลย และเห็นรูปเฉพาะคนที่เปิด &quot;แสดงรูปบนหน้าสาธารณะ&quot;
        <br />
        หมายเหตุ: LINE ไม่เปิดเผย LINE ID ให้ระบบ จึงแสดงได้แค่ชื่อที่ตั้งใน LINE และรูปโปรไฟล์ — ใช้ช่อง &quot;ชื่อเรียก&quot; ใส่เองเพื่อให้จำง่าย
      </p>
    </div>
  );
}
