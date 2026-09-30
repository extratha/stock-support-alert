import Link from "next/link";
import { SortableStocks, type StockCardData } from "@/components/SortableStocks";
import { listTrackedSymbols } from "@/lib/db/symbols";
import { formatDateTime } from "@/lib/format/datetime";

export const dynamic = "force-dynamic";


export default async function DashboardPage() {
  const stocks = await listTrackedSymbols();

  if (stocks.length === 0) {
    return (
      <div className="surface p-8 text-center">
        <p className="text-muted">
          ยังไม่มีหุ้นที่ track — ไปที่{" "}
          <Link className="text-primary underline underline-offset-4" href="/symbols">
            จัดการหุ้น
          </Link>{" "}
          เพื่อเพิ่ม symbol
        </p>
      </div>
    );
  }

  // Only plain, pre-formatted data crosses into the client component (no Dates, no hydration drift).
  const cards: StockCardData[] = stocks.map((s) => ({
    symbol: s.symbol,
    price: s.price,
    quoteTimeLabel: s.quoteTime ? formatDateTime(s.quoteTime) : null,
    asOf: s.asOf,
    refClose: s.refClose,
    levels: s.levels,
  }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">แนวรับปัจจุบัน</h1>
        <p className="mt-1 text-sm text-muted">กำลัง track {stocks.length} ตัว · ข้อมูลจากรอบเช็คล่าสุด</p>
      </div>
      {/* key: remount with the server order whenever the symbol list/order changes */}
      <SortableStocks key={cards.map((c) => c.symbol).join(",")} initial={cards} />
    </div>
  );
}
