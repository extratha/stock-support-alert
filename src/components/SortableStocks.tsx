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
import { useEffect, useState } from "react";
import { DEFAULT_RULES } from "@/lib/alerts/evaluate";
import { apiFetch } from "@/lib/apiFetch";
import { formatDateString, formatDateTime } from "@/lib/format/datetime";
import type { PriceEntry } from "@/lib/stock/live";
import { METHOD_LABEL, type Method, type Tier } from "@/lib/support/types";
import { GripIcon, RefreshIcon } from "./icons";
import { Spinner } from "./Spinner";
import { TierBadge } from "./TierBadge";

/** Plain serializable data (dates already formatted on the server). */
export interface StockCardData {
  symbol: string;
  price: number | null;
  quoteTimeLabel: string | null;
  asOf: string | null;
  refClose: number | null;
  levels: { tier: Tier; price: number; method: string }[];
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

function StockCard({ stock, live, dragging }: { stock: StockCardData; live?: PriceEntry; dragging?: boolean }) {
  // Live price (display only) wins; otherwise the price saved by the scheduled Twelve Data check.
  const s = { ...stock, price: live?.price ?? stock.price };
  const priceLabel = live
    ? `ราคา ณ ${live.asOf ? formatDateTime(new Date(live.asOf)) : "—"} · ${SOURCE_LABEL[live.source]}${live.stale ? " (ค่าเก่า)" : ""}`
    : s.quoteTimeLabel
      ? `ราคา ณ ${s.quoteTimeLabel}`
      : "ยังไม่มีราคา (รอรอบเช็คถัดไป)";
  return (
    <>
      <div className="flex items-start justify-between gap-4">
        <h2 className="font-mono text-xl font-semibold tracking-wide">{s.symbol}</h2>
        <div className="text-right">
          <div className="font-mono text-xl font-medium tabular-nums">{s.price !== null ? usd(s.price) : "—"}</div>
          <div className="text-xs text-muted">{priceLabel}</div>
        </div>
      </div>

      {s.levels.length === 0 ? (
        <p className="mt-4 text-sm text-muted">ยังไม่มีแนวรับ</p>
      ) : (
        <ul className="mt-4 divide-y divide-border rounded-xl border border-border bg-background/40">
          {s.levels.map((l) => {
            const dist = s.price !== null ? ((s.price - l.price) / l.price) * 100 : null;
            const touched = s.price !== null && s.price <= l.price * (1 + DEFAULT_RULES.touchTolerance);
            return (
              <li
                key={l.tier}
                className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1 px-3 py-2.5 sm:grid-cols-[9.5rem_1fr_auto]"
              >
                <div className="justify-self-start">
                  <TierBadge tier={l.tier} />
                </div>
                <div className="order-3 col-span-2 flex items-baseline gap-2 sm:order-none sm:col-span-1">
                  <span className="font-mono text-base tabular-nums">{usd(l.price)}</span>
                  <span className="text-xs text-muted">{METHOD_LABEL[l.method as Method] ?? l.method}</span>
                </div>
                <div className="justify-self-end font-mono text-sm tabular-nums">
                  {touched ? (
                    <span className="rounded-md bg-danger/15 px-2 py-0.5 font-sans text-xs font-semibold text-danger ring-1 ring-danger/30">
                      แตะแล้ว
                    </span>
                  ) : dist !== null ? (
                    <span className={dist < 2 ? "text-warning" : "text-muted"}>+{dist.toFixed(1)}%</span>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {s.asOf && !dragging && (
        <p className="mt-3 text-xs text-muted">
          คำนวณจากข้อมูลถึง {formatDateString(s.asOf)} (close <span className="font-mono">{usd(s.refClose ?? 0)}</span>)
        </p>
      )}
    </>
  );
}

function SortableCard({ stock, live }: { stock: StockCardData; live?: PriceEntry }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id: stock.symbol,
  });
  return (
    <section
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`surface relative p-5 ${
        isDragging ? "z-20 scale-[1.02] shadow-2xl shadow-black/60 ring-2 ring-primary/60" : ""
      }`}
    >
      {/* Press & hold the handle, then drag. touch-none stops the page scrolling instead of dragging. */}
      <button
        type="button"
        ref={setActivatorNodeRef}
        {...attributes}
        {...listeners}
        aria-label={`ลากเพื่อจัดลำดับ ${stock.symbol}`}
        className={`absolute right-2 top-2 grid size-11 touch-none place-items-center rounded-lg text-muted transition-colors duration-150 hover:bg-elevated hover:text-primary ${
          isDragging ? "cursor-grabbing text-primary" : "cursor-grab"
        }`}
      >
        <GripIcon className="size-5" />
      </button>
      {/* Leave room for the handle so it never covers the price. */}
      <div className="pr-10">
        <StockCard stock={stock} live={live} dragging={isDragging} />
      </div>
    </section>
  );
}

/** `force` = the refresh button: skip the 5-minute shared cache (the server still rate-limits per symbol). */
async function loadPrices(force = false): Promise<Record<string, PriceEntry>> {
  const res = await apiFetch(force ? "/api/prices?force=1" : "/api/prices");
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return ((await res.json()) as { prices: Record<string, PriceEntry> }).prices;
}

export function SortableStocks({ initial }: { initial: StockCardData[] }) {
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
              <SortableCard key={s.symbol} stock={s} live={prices[s.symbol]} />
            ))}
          </div>
        </SortableContext>
      </DndContext>
    </div>
  );
}
