import Link from "next/link";
import { SortableStocks, type StockCardData } from "@/components/SortableStocks";
import { config } from "@/lib/config";
import { listProfiles } from "@/lib/db/profiles";
import { listSupportTests } from "@/lib/db/supports";
import { listTrackedSymbols } from "@/lib/db/symbols";
import { nyToday } from "@/lib/market/calendar";
import { toProfileData } from "@/lib/profile/describe";
import { summarizeTrack } from "@/lib/support/track";
import { TIER_LABEL_TH } from "@/lib/support/types";
import { formatDateTime } from "@/lib/format/datetime";
import { PAGE_DATA_TIMEOUT_MS, withTimeout } from "@/lib/timeout";
import { isOwner } from "@/lib/viewer";

export const dynamic = "force-dynamic";
export const metadata = { title: "แนวรับปัจจุบัน", description: "แนวรับของหุ้น US ที่ติดตาม คำนวณอัตโนมัติจาก Pivot, MA50/200, Swing Low และ Fibonacci พร้อมสถิติย้อนหลังว่าแนวรับเคยรับได้จริงไหม" };


export default async function DashboardPage() {
  const owner = await isOwner();
  const [stocks, profiles, tests] = await withTimeout(
    // the page still works without profiles or level history
    Promise.all([listTrackedSymbols(), listProfiles().catch(() => []), listSupportTests().catch(() => [])]),
    PAGE_DATA_TIMEOUT_MS,
    "load tracked symbols",
  );

  if (stocks.length === 0) {
    return (
      <div className="surface p-8 text-center">
        <p className="text-muted">
          {owner ? (
            <>
              ยังไม่มีหุ้นที่ track — ไปที่{" "}
              <Link className="text-primary underline underline-offset-4" href="/symbols">
                จัดการหุ้น
              </Link>{" "}
              เพื่อเพิ่ม symbol
            </>
          ) : (
            "ยังไม่มีหุ้นที่ติดตาม"
          )}
        </p>
      </div>
    );
  }

  const today = nyToday();
  const alertTiers = config.alertTiers();
  // Only plain, pre-formatted data crosses into the client component (no Dates, no hydration drift).
  const cards: StockCardData[] = stocks.map((s) => ({
    symbol: s.symbol,
    logoVersion: s.logoVersion,
    price: s.price,
    quoteTimeLabel: s.quoteTime ? formatDateTime(s.quoteTime) : null,
    asOf: s.asOf,
    refClose: s.refClose,
    levels: s.levels.map((l) => ({ ...l, alerts: alertTiers.includes(l.tier) })),
    track: summarizeTrack(tests.filter((t) => t.symbol === s.symbol), today),
    profile: (() => {
      const p = profiles.find((x) => x.symbol === s.symbol);
      return p ? toProfileData(p) : null;
    })(),
  }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">แนวรับปัจจุบัน</h1>
        <p className="mt-1 text-sm text-muted">
          กำลัง track {stocks.length} ตัว · ข้อมูลจากรอบเช็คล่าสุด · แจ้งเตือนทาง LINE เฉพาะ{" "}
          {alertTiers.map((t) => TIER_LABEL_TH[t]).join(", ")}
        </p>
      </div>
      {/* key: remount with the server order whenever the symbol list/order changes */}
      <SortableStocks key={cards.map((c) => c.symbol).join(",")} initial={cards} today={today} readOnly={!owner} />
    </div>
  );
}
