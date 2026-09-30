import { SymbolManager } from "@/components/SymbolManager";
import { config } from "@/lib/config";
import { listSymbols } from "@/lib/db/symbols";
import { recipients } from "@/lib/jobs/notify";
import { PAGE_DATA_TIMEOUT_MS, withTimeout } from "@/lib/timeout";

export const dynamic = "force-dynamic";

export default async function SymbolsPage() {
  const [symbols, subscribers] = await withTimeout(
    Promise.all([listSymbols(), recipients()]),
    PAGE_DATA_TIMEOUT_MS,
    "load symbols",
  );
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">จัดการหุ้นที่ track</h1>
        <p className="mt-1 text-sm text-muted">เพิ่มหรือลบ symbol ระบบจะคำนวณแนวรับให้อัตโนมัติ</p>
      </div>
      <SymbolManager initial={symbols} max={config.maxTrackedSymbols()} subscribers={subscribers.length} />
    </div>
  );
}
