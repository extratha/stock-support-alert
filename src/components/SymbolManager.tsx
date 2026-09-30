"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

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

  return (
    <div className="space-y-6">
      <form onSubmit={add} className="flex gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="เช่น NVDA"
          maxLength={10}
          className="w-40 rounded-lg border border-border bg-card px-3 py-2 uppercase"
        />
        <button
          disabled={busy || initial.length >= max}
          className="rounded-lg bg-foreground px-4 py-2 text-background disabled:opacity-50"
        >
          {busy ? "กำลังทำงาน…" : "เพิ่ม"}
        </button>
        <span className="self-center text-sm text-muted">
          {initial.length}/{max}
        </span>
      </form>

      {message && (
        <p className={message.kind === "ok" ? "text-sm text-green-600" : "text-sm text-red-500"}>{message.text}</p>
      )}

      <ul className="divide-y divide-border rounded-xl border border-border">
        {initial.length === 0 && <li className="p-4 text-muted">ยังไม่มีหุ้น</li>}
        {initial.map((s) => (
          <li key={s} className="flex items-center justify-between p-3">
            <span className="font-semibold">{s}</span>
            <button
              disabled={busy}
              onClick={() => confirm(`ลบ ${s}?`) && call(`/api/symbols/${encodeURIComponent(s)}`, { method: "DELETE" }, `ลบ ${s} แล้ว`)}
              className="text-sm text-red-500 hover:underline disabled:opacity-50"
            >
              ลบ
            </button>
          </li>
        ))}
      </ul>

      <div className="rounded-xl border border-border bg-card p-4 text-sm">
        <p>
          ผู้รับแจ้งเตือนผ่าน LINE: <strong>{subscribers}</strong> คน
          {subscribers === 0 && <span className="text-muted"> — เพิ่ม LINE OA เป็นเพื่อนเพื่อลงทะเบียน</span>}
        </p>
        <button
          disabled={busy || subscribers === 0}
          onClick={() => call("/api/line/test", { method: "POST" }, "ส่งข้อความทดสอบแล้ว")}
          className="mt-3 rounded-lg border border-border px-3 py-1.5 hover:bg-background disabled:opacity-50"
        >
          ส่งข้อความทดสอบ
        </button>
      </div>
    </div>
  );
}
