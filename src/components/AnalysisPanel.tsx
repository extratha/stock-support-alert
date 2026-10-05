"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/apiFetch";
import { formatDateTime } from "@/lib/format/datetime";
import { GOALS, type AnalysisView, type GoalId } from "@/lib/analysis/types";
import { CheckIcon, CopyIcon, SparklesIcon } from "./icons";
import { Spinner } from "./Spinner";

const usd = (n: number) => `$${n.toFixed(2)}`;

function Result({ a }: { a: AnalysisView }) {
  const goalLabels = a.goals.map((id) => GOALS.find((g) => g.id === id)?.label ?? id);
  return (
    <section aria-label="ผลวิเคราะห์" className="space-y-4">
      <div className="surface space-y-2 p-4">
        <p className="text-xs text-muted">
          วิเคราะห์เมื่อ {formatDateTime(new Date(a.createdAt))} · โมเดล <span className="font-mono">{a.model}</span> · ดูหุ้น {a.universe} ตัว ·
          เป้าหมาย: {goalLabels.length > 0 ? goalLabels.join(", ") : "ภาพรวมสมดุล"}
        </p>
        {a.skipped.length > 0 && (
          <p className="text-xs text-warning">
            ใช้โมเดลสำรอง: {a.skipped.map((s) => `${s.model} ใช้ไม่ได้ (${s.reason})`).join(", ")} จึงสลับมาใช้ {a.model}
          </p>
        )}
        {a.summary && <p className="text-sm leading-relaxed">{a.summary}</p>}
      </div>

      <ol className="space-y-3">
        {a.picks.map((p) => (
          <li key={p.symbol} className="surface p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <span className="grid size-8 shrink-0 place-items-center rounded-full bg-primary/10 font-mono text-sm font-semibold text-primary ring-1 ring-primary/30">
                  {p.rank}
                </span>
                <h2 className="font-mono text-lg font-semibold tracking-wide">{p.symbol}</h2>
              </div>
              {p.price !== null && <span className="font-mono text-lg tabular-nums">{usd(p.price)}</span>}
            </div>

            {p.reasons.length > 0 && (
              <ul className="mt-3 space-y-1 text-sm">
                {p.reasons.map((r, i) => (
                  <li key={i} className="flex gap-2">
                    <span aria-hidden="true" className="mt-2 size-1.5 shrink-0 rounded-full bg-success" />
                    <span>{r}</span>
                  </li>
                ))}
              </ul>
            )}
            {p.risks.length > 0 && (
              <ul className="mt-2 space-y-1 text-sm text-muted">
                {p.risks.map((r, i) => (
                  <li key={i} className="flex gap-2">
                    <span aria-label="ความเสี่ยง" className="mt-2 size-1.5 shrink-0 rounded-full bg-warning" />
                    <span>{r}</span>
                  </li>
                ))}
              </ul>
            )}
            {p.entryNote && <p className="mt-3 border-t border-border pt-3 text-xs leading-relaxed text-muted">{p.entryNote}</p>}
          </li>
        ))}
      </ol>

      {a.caveats.length > 0 && (
        <ul className="space-y-1 text-xs leading-relaxed text-muted">
          {a.caveats.map((c, i) => (
            <li key={i}>• {c}</li>
          ))}
        </ul>
      )}
      <p className="text-xs leading-relaxed text-muted">
        ผลนี้สร้างโดย AI จากตัวเลขในระบบเท่านั้น (ไม่ได้อ่านข่าวหรืองบล่าสุด) อาจผิดพลาดได้ และไม่ใช่คำแนะนำการลงทุน — backtest ของระบบยังไม่พบว่าการซื้อตามแนวรับให้ผลดีกว่าซื้อวันอื่นอย่างมีนัยสำคัญ
        ใช้เพื่อช่วยคัดว่าตัวไหนควรดูต่อ ไม่ใช่สัญญาณซื้อ
      </p>
    </section>
  );
}

export function AnalysisPanel({
  initial,
  used: initialUsed,
  limit,
  missing,
  models,
}: {
  initial: AnalysisView | null;
  used: number;
  limit: number;
  /** names of the AI environment variables not set yet (empty = ready) */
  missing: string[];
  /** models from AI_MODEL: the first is the default, the rest are fallbacks and can be picked */
  models: string[];
}) {
  const [goals, setGoals] = useState<Set<GoalId>>(new Set());
  const [model, setModel] = useState(models[0] ?? "");
  const [result, setResult] = useState(initial);
  const [used, setUsed] = useState(initialUsed);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copy, setCopy] = useState<"idle" | "busy" | "copied">("idle");

  useEffect(() => {
    if (copy !== "copied") return;
    const t = setTimeout(() => setCopy("idle"), 2500);
    return () => clearTimeout(t);
  }, [copy]);

  /** The same prompt and data, to paste into any AI chat: no AI call here, so it works without settings or quota. */
  async function copyPrompt() {
    setCopy("busy");
    setError(null);
    try {
      const res = await apiFetch("/api/analysis/prompt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ goals: [...goals] }),
      });
      const body = (await res.json().catch(() => ({}))) as { text?: string; error?: string };
      if (!res.ok || !body.text) throw new Error(body.error ?? `สร้างข้อความไม่สำเร็จ (HTTP ${res.status})`);
      await navigator.clipboard.writeText(body.text);
      setCopy("copied");
    } catch (err) {
      setCopy("idle");
      setError(err instanceof Error ? err.message : "คัดลอกไม่สำเร็จ");
    }
  }

  const ready = missing.length === 0;
  const left = Math.max(0, limit - used);

  function toggle(id: GoalId) {
    setGoals((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }

  async function run() {
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch("/api/analysis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ goals: [...goals], ...(models.length > 1 ? { model } : {}) }),
      });
      const body = (await res.json().catch(() => ({}))) as { analysis?: AnalysisView; error?: string; used?: number | null };
      if (typeof body.used === "number") setUsed(body.used);
      if (!res.ok || !body.analysis) throw new Error(body.error ?? `วิเคราะห์ไม่สำเร็จ (HTTP ${res.status})`);
      setResult(body.analysis);
    } catch (err) {
      setError(err instanceof Error ? err.message : "วิเคราะห์ไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">วิเคราะห์ด้วย AI</h1>
        <p className="mt-1 text-sm text-muted">
          ส่งหุ้นทุกตัวที่ track พร้อมราคาปัจจุบัน ข้อมูลพื้นฐาน ความเสี่ยง และแนวรับ ให้ AI จัดอันดับตัวที่ควรดูต่อสูงสุด 5 ตัว ตามเป้าหมายที่เลือก
        </p>
      </div>

      {!ready && (
        <div role="alert" className="surface border-warning/40 p-4 text-sm">
          <p className="font-medium text-warning">ยังไม่ได้ตั้งค่า AI</p>
          <p className="mt-1 text-muted">
            เพิ่ม environment variable{" "}
            {missing.map((m, i) => (
              <span key={m}>
                {i > 0 && ", "}
                <code className="font-mono text-foreground">{m}</code>
              </span>
            ))}{" "}
            ใน Vercel แล้ว redeploy (ดูวิธีใน README หัวข้อ &quot;วิเคราะห์ด้วย AI&quot;)
          </p>
        </div>
      )}

      <fieldset className="space-y-2" disabled={busy}>
        <legend className="text-sm font-medium">เป้าหมาย (เลือกได้หลายข้อ ไม่เลือก = ดูภาพรวมสมดุล)</legend>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {GOALS.map((g) => {
            const on = goals.has(g.id);
            return (
              <button
                key={g.id}
                type="button"
                aria-pressed={on}
                onClick={() => toggle(g.id)}
                className={`cursor-pointer rounded-xl border px-3 py-2.5 text-left transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-60 ${
                  on ? "border-primary/50 bg-primary/10" : "border-border bg-card hover:border-primary/40"
                }`}
              >
                <span className={`block text-sm font-medium ${on ? "text-primary" : ""}`}>{g.label}</span>
                <span className="mt-0.5 block text-xs leading-relaxed text-muted">{g.hint}</span>
              </button>
            );
          })}
        </div>
      </fieldset>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <button
          type="button"
          onClick={run}
          disabled={busy || !ready || left === 0}
          className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-lg bg-primary px-5 font-medium text-on-primary transition-[filter,opacity] duration-150 hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? <Spinner /> : <SparklesIcon />}
          {busy ? "กำลังวิเคราะห์…" : "วิเคราะห์ด้วย AI"}
        </button>
        <button
          type="button"
          onClick={copyPrompt}
          disabled={busy || copy === "busy"}
          title="คัดลอกคำสั่งและข้อมูลชุดเดียวกัน ไปวางในแชท AI ที่ใช้อยู่ (ไม่ใช้โควตา)"
          className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-border bg-card px-4 text-sm transition-colors duration-150 hover:border-primary/50 hover:text-primary disabled:cursor-not-allowed disabled:opacity-50"
        >
          {copy === "busy" ? <Spinner /> : copy === "copied" ? <CheckIcon /> : <CopyIcon />}
          <span aria-live="polite">{copy === "copied" ? "คัดลอกแล้ว วางในแชท AI ได้เลย" : "คัดลอกไปถาม AI เอง"}</span>
        </button>
        <span className="text-xs text-muted">
          วันนี้ใช้ไปแล้ว <span className="font-mono tabular-nums">{used}/{limit}</span> ครั้ง
          {models.length === 1 && <> · โมเดล <span className="font-mono">{models[0]}</span></>}
        </span>
        {models.length > 1 && (
          <label className="flex items-center gap-2 text-xs text-muted">
            โมเดล
            <select
              value={model}
              onChange={(e) => setModel(e.target.value)}
              disabled={busy}
              className="min-h-11 cursor-pointer rounded-lg border border-border bg-card px-2 font-mono text-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/40 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {models.map((m, i) => (
                <option key={m} value={m}>
                  {m}
                  {i === 0 ? " (หลัก)" : ""}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      <div aria-live="polite" className="min-h-5">
        {busy && <p className="text-sm text-muted">AI กำลังอ่านข้อมูลหุ้นทั้งหมด อาจใช้เวลาถึง 1 นาที</p>}
        {error && <p className="text-sm text-danger">{error}</p>}
      </div>

      {result ? (
        <Result a={result} />
      ) : (
        <div className="surface p-8 text-center text-sm text-muted">ยังไม่เคยวิเคราะห์ — เลือกเป้าหมายแล้วกด &quot;วิเคราะห์ด้วย AI&quot;</div>
      )}
    </div>
  );
}
