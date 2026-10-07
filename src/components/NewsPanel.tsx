"use client";

import { useState } from "react";
import { apiFetch } from "@/lib/apiFetch";
import { formatDateTime } from "@/lib/format/datetime";
import {
  DIRECTION_LABEL,
  IMPACT_LABEL,
  POINT_KIND_LABEL,
  type Direction,
  type Impact,
  type NewsBriefView,
  type NewsPoint,
  type NewsRef,
  type PointKind,
} from "@/lib/news/types";
import { NewspaperIcon } from "./icons";
import { Spinner } from "./Spinner";

const DIRECTION_CLASS: Record<Direction, string> = {
  positive: "bg-success/10 text-success ring-success/30",
  negative: "bg-danger/10 text-danger ring-danger/30",
  mixed: "bg-warning/10 text-warning ring-warning/30",
  neutral: "bg-muted/10 text-muted ring-border",
};
const IMPACT_CLASS: Record<Impact, string> = {
  high: "text-foreground font-semibold",
  medium: "text-foreground",
  low: "text-muted",
};
const KIND_CLASS: Record<PointKind, string> = {
  fact: "text-primary",
  opinion: "text-warning",
  inference: "text-muted",
};

const chip = "inline-flex items-center rounded-md px-2 py-0.5 text-xs ring-1";

function Sources({ ids, refs }: { ids: number[]; refs: NewsRef[] }) {
  return (
    <span className="ml-1 inline-flex flex-wrap gap-1 align-baseline">
      {ids.map((n) => {
        const ref = refs.find((r) => r.n === n);
        if (!ref) return null;
        return (
          <a
            key={n}
            href={ref.url}
            target="_blank"
            rel="noopener noreferrer"
            title={`${ref.source}: ${ref.headline}`}
            className="font-mono text-xs text-primary underline-offset-2 hover:underline"
          >
            [{n}]
          </a>
        );
      })}
    </span>
  );
}

function Points({ points, refs }: { points: NewsPoint[]; refs: NewsRef[] }) {
  if (points.length === 0) return null;
  return (
    <ul className="mt-3 space-y-1.5 text-sm">
      {points.map((p, i) => (
        <li key={i} className="leading-relaxed">
          <span className={`mr-1.5 text-xs font-medium ${KIND_CLASS[p.kind]}`}>{POINT_KIND_LABEL[p.kind]}</span>
          {p.text}
          <Sources ids={p.sources} refs={refs} />
        </li>
      ))}
    </ul>
  );
}

function RefList({ refs }: { refs: NewsRef[] }) {
  if (refs.length === 0) return null;
  return (
    <details className="mt-3 border-t border-border pt-3">
      <summary className="cursor-pointer text-xs text-muted hover:text-foreground">ข่าวที่ AI อ่าน ({refs.length})</summary>
      <ul className="mt-2 space-y-1.5 text-xs">
        {refs.map((r) => (
          <li key={r.n} className="flex gap-2">
            <span className="font-mono text-muted">[{r.n}]</span>
            <span>
              <a href={r.url} target="_blank" rel="noopener noreferrer" className="hover:text-primary hover:underline">
                {r.headline}
              </a>
              <span className="text-muted">
                {" "}
                · {r.source} · {formatDateTime(new Date(r.publishedAt))}
                {!r.fullText && " · อ่านได้แค่หัวข่าว/เรื่องย่อ"}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </details>
  );
}

function Brief({ b }: { b: NewsBriefView }) {
  const marketRefs = b.refs.filter((r) => r.symbols.length === 0);
  const full = b.refs.filter((r) => r.fullText).length;
  return (
    <section aria-label="สรุปข่าว" className="space-y-4">
      <div className="surface space-y-1 p-4 text-xs text-muted">
        <p>
          สรุปเมื่อ {formatDateTime(new Date(b.createdAt))} ({b.trigger === "schedule" ? "รอบก่อนตลาดเปิด" : "กดสรุปเอง"}) · ข่าวช่วง{" "}
          {formatDateTime(new Date(b.windowFrom))} – {formatDateTime(new Date(b.windowTo))}
        </p>
        <p>
          AI อ่าน {b.refs.length} ข่าว (เนื้อข่าวเต็ม {full} · หัวข่าว/เรื่องย่อ {b.refs.length - full}) · โมเดล <span className="font-mono">{b.model}</span>
        </p>
        {b.skipped.length > 0 && (
          <p className="text-warning">ใช้โมเดลสำรอง: {b.skipped.map((s) => `${s.model} ใช้ไม่ได้ (${s.reason})`).join(", ")}</p>
        )}
      </div>

      {(b.market.summary || b.market.points.length > 0) && (
        <div className="surface p-4">
          <h2 className="font-semibold">ภาพรวมตลาด</h2>
          {b.market.summary && <p className="mt-2 text-sm leading-relaxed">{b.market.summary}</p>}
          <Points points={b.market.points} refs={b.refs} />
          <RefList refs={marketRefs} />
        </div>
      )}

      <ul className="space-y-3">
        {b.stocks.map((s) => (
          <li key={s.symbol} className="surface p-4">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="mr-1 font-mono text-lg font-semibold tracking-wide">{s.symbol}</h2>
              <span className={`${chip} ${DIRECTION_CLASS[s.direction]}`}>{DIRECTION_LABEL[s.direction]}</span>
              <span className={`text-xs ${IMPACT_CLASS[s.impact]}`}>{IMPACT_LABEL[s.impact]}</span>
            </div>
            {s.summary ? (
              <p className="mt-2 text-sm leading-relaxed">{s.summary}</p>
            ) : (
              s.points.length === 0 && <p className="mt-2 text-sm text-muted">AI ไม่ได้สรุปตัวนี้ — ดูข่าวที่เกี่ยวข้องด้านล่าง</p>
            )}
            <Points points={s.points} refs={b.refs} />
            <RefList refs={b.refs.filter((r) => r.symbols.includes(s.symbol))} />
          </li>
        ))}
      </ul>

      {b.quiet.length > 0 && (
        <p className="text-sm text-muted">
          ไม่มีข่าวใหม่ในช่วงนี้: <span className="font-mono">{b.quiet.join(", ")}</span>
        </p>
      )}
      {b.caveats.length > 0 && (
        <ul className="space-y-1 text-xs leading-relaxed text-muted">
          {b.caveats.map((c, i) => (
            <li key={i}>• {c}</li>
          ))}
        </ul>
      )}
      <p className="text-xs leading-relaxed text-muted">
        สรุปโดย AI จากข่าวฟรีที่ระบบเก็บได้เท่านั้น อาจตกหล่นหรือตีความผิด ข่าวฟรีมักออกช้ากว่าแหล่งข่าวแบบเสียเงิน และราคามักตอบสนองไปแล้วบางส่วน
        ตรวจกับข่าวต้นทางทุกครั้ง — &quot;ความเห็น&quot; คือมุมมองของผู้เขียน และ &quot;AI ตีความ&quot; คือการคาดของ AI เอง ไม่ใช่คำแนะนำการลงทุน
      </p>
    </section>
  );
}

export function NewsPanel({
  initial,
  used: initialUsed,
  limit,
  missing,
  readOnly = false,
}: {
  initial: NewsBriefView | null;
  used: number;
  limit: number;
  /** AI environment variables not set yet (empty = ready) */
  missing: string[];
  /** a visitor of the public site: the latest brief only, no button */
  readOnly?: boolean;
}) {
  const [brief, setBrief] = useState(initial);
  const [used, setUsed] = useState(initialUsed);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ready = missing.length === 0;
  const left = Math.max(0, limit - used);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch("/api/news", { method: "POST" });
      const body = (await res.json().catch(() => ({}))) as { brief?: NewsBriefView; error?: string; used?: number | null };
      if (typeof body.used === "number") setUsed(body.used);
      if (!res.ok || !body.brief) throw new Error(body.error ?? `สรุปข่าวไม่สำเร็จ (HTTP ${res.status})`);
      setBrief(body.brief);
    } catch (err) {
      setError(err instanceof Error ? err.message : "สรุปข่าวไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">ข่าวที่กระทบหุ้น</h1>
        <p className="mt-1 text-sm text-muted">
          ระบบเก็บข่าวฟรีจาก Finnhub ทุกชั่วโมง ทั้งข่าวรายหุ้นและข่าวตลาด และอ่านเนื้อข่าวเต็มเมื่อเว็บต้นทางเปิดให้อ่าน แล้วให้ AI สรุปว่ากระทบหุ้นที่ track
          อย่างไร ทุกวันทำการก่อนตลาดเปิด{readOnly ? "" : " (หรือกดสรุปเองได้)"}
        </p>
      </div>

      {!readOnly && !ready && (
        <div role="alert" className="surface border-warning/40 p-4 text-sm">
          <p className="font-medium text-warning">ยังไม่ได้ตั้งค่า AI</p>
          <p className="mt-1 text-muted">ใช้ค่าเดียวกับหน้า &quot;วิเคราะห์ด้วย AI&quot;: {missing.join(", ")}</p>
        </div>
      )}

      {!readOnly && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <button
            type="button"
            onClick={run}
            disabled={busy || !ready || left === 0}
            className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-lg bg-primary px-5 font-medium text-on-primary transition-[filter,opacity] duration-150 hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? <Spinner /> : <NewspaperIcon />}
            {busy ? "กำลังอ่านข่าว…" : "สรุปข่าวตอนนี้"}
          </button>
          <span className="text-xs text-muted">
            วันนี้สรุปไปแล้ว <span className="font-mono tabular-nums">{used}/{limit}</span> ครั้ง (รวมรอบอัตโนมัติ)
          </span>
        </div>
      )}

      {!readOnly && (
        <div aria-live="polite" className="min-h-5">
          {busy && <p className="text-sm text-muted">กำลังดึงข่าวล่าสุดและให้ AI อ่าน ปกติ 1–3 นาที อาจนานถึงราว 5 นาที อย่าปิดหน้านี้</p>}
          {error && <p className="text-sm text-danger">{error}</p>}
        </div>
      )}

      {brief ? (
        <Brief b={brief} />
      ) : (
        <div className="surface p-8 text-center text-sm text-muted">
          {readOnly ? "ยังไม่มีสรุปข่าว — รอรอบก่อนตลาดเปิด" : <>ยังไม่มีสรุปข่าว — รอรอบก่อนตลาดเปิด หรือกด &quot;สรุปข่าวตอนนี้&quot;</>}
        </div>
      )}
    </div>
  );
}
