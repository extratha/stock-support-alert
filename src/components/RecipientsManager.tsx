"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { apiFetch } from "@/lib/apiFetch";
import { RefreshIcon } from "./icons";
import { Spinner } from "./Spinner";

export interface RecipientRow {
  userId: string;
  displayName: string | null;
  pictureUrl: string | null;
  label: string | null;
  active: boolean;
  notify: boolean;
  followedAtLabel: string;
}

const shortId = (id: string) => `${id.slice(0, 5)}…${id.slice(-4)}`;

function Avatar({ user }: { user: RecipientRow }) {
  const initial = (user.label || user.displayName || "?").trim().charAt(0).toUpperCase();
  return user.pictureUrl ? (
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
  ) : (
    <span
      aria-hidden="true"
      className="grid size-11 shrink-0 place-items-center rounded-full bg-elevated text-base font-semibold text-muted ring-1 ring-border"
    >
      {initial}
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
      placeholder="ชื่อเรียก (เช่น LINE ID: extratha)"
      aria-label={`ชื่อเรียกของ ${user.displayName ?? shortId(user.userId)}`}
      className="min-h-9 w-full max-w-xs rounded-md border border-border bg-background/60 px-2 text-sm placeholder:text-muted focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/40 disabled:opacity-60"
    />
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

export function RecipientsManager({ users, max }: { users: RecipientRow[]; max: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null); // userId being updated, or "refresh"
  const [message, setMessage] = useState<Message | null>(null);

  const enabled = users.filter((u) => u.active && u.notify).length;
  const full = enabled >= max;

  async function request(key: string, url: string, init: RequestInit, ok: string | ((body: ApiBody) => Message)) {
    setBusy(key);
    setMessage(null);
    try {
      const res = await apiFetch(url, init);
      const body = (await res.json().catch(() => ({}))) as ApiBody;
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      setMessage(typeof ok === "string" ? { kind: "ok", text: ok } : ok(body));
      router.refresh();
    } catch (err) {
      setMessage({ kind: "error", text: err instanceof Error ? err.message : "เกิดข้อผิดพลาด" });
    } finally {
      setBusy(null);
    }
  }

  const patch = (userId: string, payload: { notify?: boolean; label?: string }, ok: string | ((body: ApiBody) => Message)) =>
    request(
      userId,
      `/api/line/users/${userId}`,
      { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) },
      ok,
    );

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
            const rowBusy = busy === u.userId;
            const cannotEnable = !u.notify && (full || !u.active);
            return (
              <li key={u.userId} className="flex flex-wrap items-center gap-x-4 gap-y-3 px-4 py-3">
                <Avatar user={u} />
                <div className="min-w-0 flex-1 basis-56 space-y-1.5">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className={`truncate font-medium ${u.displayName ? "" : "text-muted"}`}>{name}</span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs ring-1 ${
                        u.active ? "bg-success/12 text-success ring-success/30" : "bg-elevated text-muted ring-border"
                      }`}
                    >
                      {u.active ? "เป็นเพื่อน" : "เลิกเป็นเพื่อนแล้ว"}
                    </span>
                  </div>
                  <LabelField
                    key={u.label ?? ""}
                    user={u}
                    disabled={busy !== null}
                    onSave={(label) => patch(u.userId, { label }, "บันทึกชื่อเรียกแล้ว")}
                  />
                  <p className="font-mono text-xs text-muted">
                    {shortId(u.userId)} · แอดเมื่อ {u.followedAtLabel}
                  </p>
                </div>

                <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm">
                  <span className={u.notify ? "text-primary" : "text-muted"}>
                    {u.notify ? "รับแจ้งเตือน" : "ไม่รับแจ้งเตือน"}
                  </span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={u.notify}
                    aria-label={`รับแจ้งเตือนของ ${name}`}
                    disabled={busy !== null || cannotEnable}
                    title={!u.active ? "เลิกเป็นเพื่อนแล้ว" : cannotEnable ? `ครบ ${max} คนแล้ว` : undefined}
                    onClick={() => patch(u.userId, { notify: !u.notify }, u.notify ? "ปิดการแจ้งเตือนแล้ว" : enabledMessage)}
                    className={`relative h-7 w-12 shrink-0 cursor-pointer rounded-full ring-1 transition-colors duration-200 disabled:cursor-not-allowed disabled:opacity-50 ${
                      u.notify ? "bg-primary/90 ring-primary" : "bg-elevated ring-border"
                    }`}
                  >
                    <span
                      className={`absolute left-0.5 top-0.5 grid size-6 place-items-center rounded-full bg-foreground transition-transform duration-200 ${
                        u.notify ? "translate-x-5" : ""
                      }`}
                    >
                      {rowBusy && <Spinner className="size-3.5 text-background" />}
                    </span>
                  </button>
                </label>
              </li>
            );
          })}
        </ul>
      )}

      <p className="text-xs text-muted">
        เมื่อเปิดรับแจ้งเตือน ระบบจะส่งข้อความแจ้งผู้รับทาง LINE 1 ข้อความ (นับโควตา push) ไม่เกิน 1 ครั้งต่อคนต่อ 24 ชั่วโมง<br />
        หมายเหตุ: LINE ไม่เปิดเผย LINE ID (เช่น extratha) ให้ระบบ จึงแสดงได้แค่ชื่อที่ตั้งใน LINE และรูปโปรไฟล์ — ใช้ช่อง &quot;ชื่อเรียก&quot; ใส่เองเพื่อให้จำง่าย
      </p>
    </div>
  );
}
