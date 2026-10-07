"use client";

import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useEffect, useState, type ReactNode } from "react";
import { DEFAULT_RULES } from "@/lib/alerts/evaluate";
import { apiFetch } from "@/lib/apiFetch";
import { formatDateString, formatDateTime } from "@/lib/format/datetime";
import { describeProfile, profileText, type ProfileData } from "@/lib/profile/describe";
import type { PriceEntry } from "@/lib/stock/live";
import type { TierRecord, TrackSummary } from "@/lib/support/track";
import { METHOD_LABEL, TIER_LABEL_TH, type Method, type Tier } from "@/lib/support/types";
import { CheckIcon, CopyIcon, GripIcon, RefreshIcon } from "./icons";
import { Spinner } from "./Spinner";
import { StockLogo } from "./StockLogo";
import { TierBadge } from "./TierBadge";

/** Plain serializable data (dates already formatted on the server). */
export interface StockCardData {
  symbol: string;
  logoVersion: number | null;
  price: number | null;
  quoteTimeLabel: string | null;
  asOf: string | null;
  refClose: number | null;
  /** `alerts` = this tier sends LINE alerts (ALERT_TIERS) */
  levels: { tier: Tier; price: number; method: string; zoneLow: number | null; touches: number | null; alerts: boolean }[];
  /** how this stock's levels behaved when the current logic is replayed over its history */
  track: TrackSummary;
  /** fundamentals + risk figures (null until the daily job has fetched them) */
  profile: ProfileData | null;
}

const usd = (n: number) => `$${n.toFixed(2)}`;

const thaiAnnouncements = {
  onDragStart: ({ active }: { active: { id: string | number } }) => `หยิบ ${active.id} แล้ว`,
  onDragOver: ({ active, over }: { active: { id: string | number }; over: { id: string | number } | null }) =>
    over ? `${active.id} อยู่เหนือ ${over.id}` : `${active.id} ไม่อยู่เหนือตำแหน่งใด`,
  onDragEnd: ({ active, over }: { active: { id: string | number }; over: { id: string | number } | null }) =>
    over ? `วาง ${active.id} ที่ตำแหน่งของ ${over.id}` : `ยกเลิกการย้าย ${active.id}`,
  onDragCancel: ({ active }: { active: { id: string | number } }) => `ยกเลิกการย้าย ${active.id}`,
};

const SOURCE_LABEL: Record<PriceEntry["source"], string> = {
  finnhub: "Finnhub",
  yahoo: "Yahoo",
  db: "รอบเช็กล่าสุด",
};

/** "ย้อนหลังรับได้ 7/12 ครั้ง (58%) · หลุด 4 — ระดับมั่วระยะเดียวกัน 55%" for one tier; null when never touched. */
function recordText(r: TierRecord): string | null {
  const total = r.held + r.broken + r.unclear;
  if (total === 0) return null;
  const pct = (x: number) => `${Math.round((x / total) * 100)}%`;
  return `ย้อนหลังรับได้ ${r.held}/${total} ครั้ง (${pct(r.held)}) · หลุด ${r.broken} — ระดับมั่วระยะเดียวกันรับได้ ${pct(r.expectedHeld)}`;
}

/** Copies the section as plain text (to paste into an AI chat for further analysis). */
function CopyButton({ text }: { text: () => string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  useEffect(() => {
    if (state === "idle") return;
    const t = setTimeout(() => setState("idle"), 2000);
    return () => clearTimeout(t);
  }, [state]);
  return (
    <button
      type="button"
      onClick={(e) => {
        // the button sits inside <summary>: don't let the click fold the section
        e.preventDefault();
        e.stopPropagation();
        navigator.clipboard.writeText(text()).then(
          () => setState("copied"),
          () => setState("failed"),
        );
      }}
      className="flex min-h-9 cursor-pointer items-center gap-1.5 rounded-lg px-2 text-xs font-normal text-muted transition-colors hover:bg-elevated hover:text-foreground"
    >
      {state === "copied" ? <CheckIcon /> : <CopyIcon />}
      <span aria-live="polite">{state === "copied" ? "คัดลอกแล้ว" : state === "failed" ? "คัดลอกไม่ได้" : "คัดลอก"}</span>
    </button>
  );
}

/** Fundamentals and risk, each figure followed by what it means in plain words. */
function ProfileSection({
  symbol,
  profile,
  price,
  today,
  copyable,
}: {
  symbol: string;
  profile: ProfileData | null;
  price: number | null;
  today: string;
  /** the copy button is for the owner (visitors of the public site get no controls) */
  copyable: boolean;
}) {
  const view = describeProfile(profile ?? undefined, price, today);
  if (view.lines.length === 0) {
    return <p className="mt-4 text-xs text-muted">ข้อมูลพื้นฐานและความเสี่ยงจะแสดงหลังรอบอัปเดตรายวัน</p>;
  }
  return (
    <details open className="group mt-4 rounded-xl border border-border bg-background/40">
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-3 text-sm font-medium [&::-webkit-details-marker]:hidden">
        <span className="flex-1">ข้อมูลพื้นฐานและความเสี่ยง</span>
        {copyable && <CopyButton text={() => profileText(symbol, price, today, view)} />}
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true" className="size-4 text-muted transition-transform duration-200 group-open:rotate-180">
          <path d="m6 9 6 6 6-6" />
        </svg>
      </summary>
      <dl className="divide-y divide-border border-t border-border">
        {view.lines.map((l) => (
          <div key={l.key} className="px-3 py-2.5">
            <div className="flex items-baseline justify-between gap-3">
              <dt className="flex items-center gap-1.5 text-xs text-muted">
                {l.caution && <span aria-label="ควรระวัง" className="size-1.5 shrink-0 rounded-full bg-warning" />}
                {l.label}
              </dt>
              <dd className={`font-mono text-sm tabular-nums ${l.caution ? "text-warning" : ""}`}>{l.value}</dd>
            </div>
            <p className="mt-1 text-xs leading-relaxed text-muted">{l.meaning}</p>
          </div>
        ))}
      </dl>
      {view.footnote && <p className="border-t border-border px-3 py-2 text-[11px] leading-relaxed text-muted">{view.footnote}</p>}
    </details>
  );
}

function StockCard({
  stock,
  live,
  dragging,
  handle,
  today,
  readOnly = false,
}: {
  stock: StockCardData;
  live?: PriceEntry;
  dragging?: boolean;
  /** The drag handle; rendered at the far right of the header row, after the price. */
  handle?: ReactNode;
  /** New York date, for "earnings in N days" */
  today: string;
  /** public visitor: no controls */
  readOnly?: boolean;
}) {
  // Live price (display only) wins; otherwise the price saved by the scheduled Twelve Data check.
  const s = { ...stock, price: live?.price ?? stock.price };
  // A level that broke but that the price has since climbed back above is support again: don't call it broken.
  const brk = s.track.recentBreak;
  const stillBroken = brk !== null && (s.price === null || s.price < Math.min(brk.level, brk.zoneLow ?? brk.level));
  const priceLabel = live
    ? `ราคา ณ ${live.asOf ? formatDateTime(new Date(live.asOf)) : "—"} · ${SOURCE_LABEL[live.source]}${live.stale ? " (ค่าเก่า)" : ""}`
    : s.quoteTimeLabel
      ? `ราคา ณ ${s.quoteTimeLabel}`
      : "ยังไม่มีราคา (รอรอบเช็คถัดไป)";
  return (
    <>
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <StockLogo symbol={s.symbol} version={s.logoVersion} />
          <h2 className="font-mono text-xl font-semibold tracking-wide">{s.symbol}</h2>
        </div>
        <div className="flex items-start gap-1">
          <div className="text-right">
            <div className="font-mono text-xl font-medium tabular-nums">{s.price !== null ? usd(s.price) : "—"}</div>
            <div className="text-xs text-muted">{priceLabel}</div>
          </div>
          {handle}
        </div>
      </div>

      {brk && stillBroken && (
        <p className="mt-4 rounded-xl bg-danger/10 px-3 py-2 text-xs leading-relaxed text-danger ring-1 ring-danger/25">
          {TIER_LABEL_TH[brk.tier]} {usd(brk.level)} ({METHOD_LABEL[brk.method] ?? brk.method}) หลุดเมื่อ{" "}
          {formatDateString(brk.resolvedOn!)} — ระดับที่แสดงด้านล่างคือระดับถัดลงไป
        </p>
      )}
      {s.levels.length === 0 ? (
        <p className="mt-4 text-sm text-muted">ยังไม่มีแนวรับ</p>
      ) : (
        <ul className="mt-4 divide-y divide-border rounded-xl border border-border bg-background/40">
          {s.levels.map((l) => {
            const dist = s.price !== null ? ((s.price - l.price) / l.price) * 100 : null;
            const touched = s.price !== null && s.price <= l.price * (1 + DEFAULT_RULES.touchTolerance);
            const record = recordText(s.track.records[l.tier]);
            return (
              <li
                key={l.tier}
                className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1 px-3 py-2.5 sm:grid-cols-[9.5rem_1fr_auto]"
              >
                <div className="justify-self-start">
                  <TierBadge tier={l.tier} />
                </div>
                <div className="order-3 col-span-2 flex flex-wrap items-baseline gap-x-2 sm:order-none sm:col-span-1">
                  <span className="font-mono text-base tabular-nums">{usd(l.price)}</span>
                  <span className="text-xs text-muted">
                    {METHOD_LABEL[l.method as Method] ?? l.method}
                    {l.zoneLow !== null && l.zoneLow < l.price && ` · โซน ${usd(l.zoneLow)}–${usd(l.price)}`}
                    {l.touches !== null && ` · เคยเด้ง ${l.touches} ครั้ง`}
                  </span>
                </div>
                <div className="justify-self-end font-mono text-sm tabular-nums">
                  {touched ? (
                    <span className="flex flex-col items-end gap-0.5">
                      <span className="rounded-md bg-danger/15 px-2 py-0.5 font-sans text-xs font-semibold text-danger ring-1 ring-danger/30">
                        แตะแล้ว
                      </span>
                      {/* the dashboard shows every tier; only ALERT_TIERS push to LINE */}
                      {!l.alerts && <span className="font-sans text-[11px] text-muted">ระดับนี้ไม่แจ้ง LINE</span>}
                    </span>
                  ) : dist !== null ? (
                    <span className={dist < 2 ? "text-warning" : "text-muted"}>+{dist.toFixed(1)}%</span>
                  ) : null}
                </div>
                {record && <p className="order-4 col-span-full text-[11px] text-muted">{record}</p>}
              </li>
            );
          })}
        </ul>
      )}
      {s.track.since && s.levels.length > 0 && !dragging && (
        <p className="mt-2 text-[11px] leading-relaxed text-muted">
          &quot;ย้อนหลัง&quot; = ใช้วิธีคำนวณปัจจุบันกับราคาจริงของหุ้นตัวนี้ตั้งแต่ {formatDateString(s.track.since)} ทุกครั้งที่ราคาแตะระดับ
          นับว่ารับได้เมื่อราคาปิดเด้งขึ้นเกิน 3% ก่อนจะปิดต่ำกว่าระดับเกิน 3% (ภายใน 20 วันทำการ) · &quot;ระดับมั่ว&quot; = เอาระยะห่างเท่ากันไปวางในวันอื่น ๆ
          ของหุ้นตัวนี้ ถ้าแนวรับรับได้ไม่มากกว่าระดับมั่ว ก็ไม่ได้มีความหมายพิเศษ — สถิติในอดีต ไม่ใช่การรับประกัน
        </p>
      )}
      {!dragging && <ProfileSection symbol={s.symbol} profile={s.profile} price={s.price} today={today} copyable={!readOnly} />}
      {s.asOf && !dragging && (
        <p className="mt-3 text-xs text-muted">
          คำนวณจากข้อมูลถึง {formatDateString(s.asOf)} (close <span className="font-mono">{usd(s.refClose ?? 0)}</span>)
        </p>
      )}
    </>
  );
}

function SortableCard({ stock, live, today }: { stock: StockCardData; live?: PriceEntry; today: string }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id: stock.symbol,
  });
  return (
    <section
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`surface p-5 ${isDragging ? "z-20 scale-[1.02] shadow-2xl shadow-black/60 ring-2 ring-primary/60" : ""}`}
    >
      <StockCard
        stock={stock}
        live={live}
        today={today}
        dragging={isDragging}
        handle={
          // Press & hold, then drag. touch-none stops the page scrolling instead of dragging.
          // It is part of the header row (right after the price) rather than floating over the card,
          // so nothing below has to reserve space for it. The negative margins keep the 44px touch
          // target while letting the dots line up with the card's content edge.
          <button
            type="button"
            ref={setActivatorNodeRef}
            {...attributes}
            {...listeners}
            aria-label={`ลากเพื่อจัดลำดับ ${stock.symbol}`}
            className={`-mr-3 -mt-2 grid size-11 shrink-0 touch-none place-items-center rounded-lg text-muted transition-colors duration-150 hover:bg-elevated hover:text-primary ${
              isDragging ? "cursor-grabbing text-primary" : "cursor-grab"
            }`}
          >
            <GripIcon className="size-5" />
          </button>
        }
      />
    </section>
  );
}

/** `force` = the refresh button: skip the 5-minute shared cache (the server still rate-limits per symbol). */
async function loadPrices(force = false): Promise<Record<string, PriceEntry>> {
  const res = await apiFetch(force ? "/api/prices?force=1" : "/api/prices");
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return ((await res.json()) as { prices: Record<string, PriceEntry> }).prices;
}

/** `readOnly` = a visitor of the public site: the cards and live prices, without dragging, refreshing or copying. */
export function SortableStocks({ initial, today, readOnly = false }: { initial: StockCardData[]; today: string; readOnly?: boolean }) {
  const [stocks, setStocks] = useState(initial);
  const [status, setStatus] = useState<{ kind: "saving" | "saved" | "error"; text: string } | null>(null);
  const [prices, setPrices] = useState<Record<string, PriceEntry>>({});
  const [priceState, setPriceState] = useState<"loading" | "ready" | "error">("loading");

  // Live prices are fetched in the browser after the page is shown, so the page itself never waits for them.
  useEffect(() => {
    let cancelled = false;
    loadPrices()
      .then((p) => {
        if (cancelled) return;
        setPrices(p);
        setPriceState("ready");
      })
      .catch(() => !cancelled && setPriceState("error"));
    return () => {
      cancelled = true;
    };
  }, []);

  async function refreshPrices() {
    setPriceState("loading");
    try {
      setPrices(await loadPrices(true));
      setPriceState("ready");
    } catch {
      setPriceState("error");
    }
  }

  const sensors = useSensors(
    // A small movement threshold keeps plain clicks on the handle from starting a drag.
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  async function onDragEnd({ active, over }: DragEndEvent) {
    if (!over || active.id === over.id) return;
    const previous = stocks;
    const from = previous.findIndex((s) => s.symbol === active.id);
    const to = previous.findIndex((s) => s.symbol === over.id);
    const next = arrayMove(previous, from, to);
    setStocks(next); // optimistic
    setStatus({ kind: "saving", text: "กำลังบันทึกลำดับ…" });
    try {
      const res = await apiFetch("/api/symbols/order", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ order: next.map((s) => s.symbol) }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setStatus({ kind: "saved", text: "บันทึกลำดับแล้ว" });
    } catch {
      setStocks(previous);
      setStatus({ kind: "error", text: "บันทึกลำดับไม่สำเร็จ — คืนลำดับเดิมแล้ว ลองอีกครั้ง" });
    }
  }

  if (readOnly) {
    return (
      <div className="space-y-3">
        {priceState === "error" && <p className="text-sm text-warning">ดึงราคาสดไม่ได้ — ใช้ราคาจากรอบเช็กล่าสุด</p>}
        <div className="grid gap-4 md:grid-cols-2">
          {stocks.map((s) => (
            <section key={s.symbol} className="surface p-5">
              <StockCard stock={s} live={prices[s.symbol]} today={today} readOnly />
            </section>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div aria-live="polite" className="flex min-h-5 items-center gap-2 text-sm">
          {status?.kind === "saving" && (
            <>
              <Spinner className="text-primary" />
              <span className="text-muted">{status.text}</span>
            </>
          )}
          {status?.kind === "saved" && <span className="text-success">{status.text}</span>}
          {status?.kind === "error" && <span className="text-danger">{status.text}</span>}
          {!status && <span className="text-muted">กดค้างที่ปุ่มจุด 6 จุดมุมการ์ดแล้วลากเพื่อจัดลำดับ</span>}
        </div>

        <div className="flex items-center gap-3 text-sm">
          {priceState === "error" && (
            <span className="text-warning">ดึงราคาสดไม่ได้ — ใช้ราคาจากรอบเช็กล่าสุด</span>
          )}
          <button
            type="button"
            onClick={refreshPrices}
            disabled={priceState === "loading"}
            className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-border bg-card px-4 transition-colors duration-150 hover:border-primary/50 hover:text-primary disabled:cursor-wait disabled:opacity-70"
          >
            {priceState === "loading" ? <Spinner className="text-primary" /> : <RefreshIcon />}
            {priceState === "loading" ? "กำลังดึงราคาสด…" : "รีเฟรชราคา"}
          </button>
        </div>
      </div>

      <DndContext
        id="stocks-dnd"
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={onDragEnd}
        accessibility={{
          announcements: thaiAnnouncements,
          screenReaderInstructions: {
            draggable: "กด Space เพื่อหยิบการ์ด ใช้ลูกศรเพื่อย้าย กด Space อีกครั้งเพื่อวาง หรือ Esc เพื่อยกเลิก",
          },
        }}
      >
        <SortableContext items={stocks.map((s) => s.symbol)} strategy={rectSortingStrategy}>
          <div className="grid gap-4 md:grid-cols-2">
            {stocks.map((s) => (
              <SortableCard key={s.symbol} stock={s} live={prices[s.symbol]} today={today} />
            ))}
          </div>
        </SortableContext>
      </DndContext>
    </div>
  );
}
