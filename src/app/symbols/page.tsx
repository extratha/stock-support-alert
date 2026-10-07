import { SymbolManager } from "@/components/SymbolManager";
import { config } from "@/lib/config";
import { listSymbolEntries } from "@/lib/db/symbols";
import { recipients } from "@/lib/jobs/notify";
import { PAGE_DATA_TIMEOUT_MS, withTimeout } from "@/lib/timeout";
import { isOwner } from "@/lib/viewer";

export const dynamic = "force-dynamic";
export const metadata = { title: "หุ้นที่ติดตาม", description: "รายชื่อหุ้น US ที่ระบบติดตามและคำนวณแนวรับให้อัตโนมัติ" };

export default async function SymbolsPage() {
  const [symbols, subscribers] = await withTimeout(
    Promise.all([listSymbolEntries(), recipients()]),
    PAGE_DATA_TIMEOUT_MS,
    "load symbols",
  );
  const owner = await isOwner();
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{owner ? "จัดการหุ้นที่ track" : "หุ้นที่ติดตาม"}</h1>
        <p className="mt-1 text-sm text-muted">
          {owner ? "เพิ่มหรือลบ symbol ระบบจะคำนวณแนวรับให้อัตโนมัติ" : "หุ้น US ที่ระบบติดตาม คำนวณแนวรับ ข้อมูลพื้นฐาน และสรุปข่าวให้ทุกวันอัตโนมัติ"}
        </p>
      </div>
      <SymbolManager initial={symbols} max={config.maxTrackedSymbols()} subscribers={subscribers.length} readOnly={!owner} />
    </div>
  );
}
