"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { PlusIcon, SendIcon, TrashIcon } from "./icons";
import { Spinner } from "./Spinner";

interface Props {
  initial: string[];
  max: number;
  subscribers: number;
}

export function SymbolManager({ initial, max, subscribers }: Props) {
  const router = useRouter();
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  async function call(url: string, init: RequestInit, okText: string) {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(url, init);
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      setMessage({ kind: "ok", text: okText });
      router.refresh();
      return true;
    } catch (err) {
      setMessage({ kind: "error", text: err instanceof Error ? err.message : "เกิดข้อผิดพลาด" });
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function add(e: FormEvent) {
    e.preventDefault();
    const symbol = input.trim().toUpperCase();
    if (!symbol) return;
    const ok = await call(
      "/api/symbols",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ symbol }) },
      `เพิ่ม ${symbol} และคำนวณแนวรับแล้ว`,
    );
    if (ok) setInput("");
  }

  const full = initial.length >= max;

  return (
    <div className="space-y-6">
      <form onSubmit={add} className="flex flex-wrap items-center gap-3">
        <label htmlFor="symbol" className="sr-only">
          Symbol หุ้น
        </label>
        <input
          id="symbol"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="เช่น NVDA"
          maxLength={10}
          autoComplete="off"
          className="min-h-11 w-44 rounded-lg border border-border bg-card px-3 font-mono uppercase tracking-wide placeholder:normal-case placeholder:text-muted focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/40"
        />
        <button
          disabled={busy || full}
          className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-lg bg-primary px-4 font-medium text-on-primary transition-[filter,opacity] duration-150 hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? <Spinner /> : <PlusIcon />}
          {busy ? "กำลังทำงาน…" : "เพิ่ม"}
        </button>
        <span className="font-mono text-sm tabular-nums text-muted" aria-label={`${initial.length} จาก ${max} ตัว`}>
          {initial.length}/{max}
        </span>
      </form>

      <div aria-live="polite" className="min-h-5">
        {message && (
          <p className={`text-sm ${message.kind === "ok" ? "text-success" : "text-danger"}`}>{message.text}</p>
        )}
      </div>

      <ul className="surface divide-y divide-border">
        {initial.length === 0 && <li className="p-4 text-muted">ยังไม่มีหุ้น</li>}
        {initial.map((s) => (
          <li key={s} className="flex items-center justify-between px-4 py-1.5">
            <span className="font-mono text-base font-semibold tracking-wide">{s}</span>
            <button
              disabled={busy}
              onClick={() =>
                confirm(`ลบ ${s}?`) && call(`/api/symbols/${encodeURIComponent(s)}`, { method: "DELETE" }, `ลบ ${s} แล้ว`)
              }
              aria-label={`ลบ ${s}`}
              className="inline-flex min-h-11 cursor-pointer items-center gap-1.5 rounded-lg px-3 text-sm text-danger transition-colors duration-150 hover:bg-danger/10 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <TrashIcon />
              ลบ
            </button>
          </li>
        ))}
      </ul>

      <div className="surface p-4 text-sm">
        <p>
          ผู้รับแจ้งเตือนผ่าน LINE: <strong className="font-mono">{subscribers}</strong> คน
          {subscribers === 0 && <span className="text-muted"> — เพิ่ม LINE OA เป็นเพื่อนเพื่อลงทะเบียน</span>}
        </p>
        <button
          disabled={busy || subscribers === 0}
          onClick={() => call("/api/line/test", { method: "POST" }, "ส่งข้อความทดสอบแล้ว")}
          className="mt-3 inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-border bg-card px-4 transition-colors duration-150 hover:border-primary/50 hover:text-primary disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? <Spinner /> : <SendIcon />}
          ส่งข้อความทดสอบ
        </button>
      </div>
    </div>
  );
}
