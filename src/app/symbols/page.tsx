import { SymbolManager } from "@/components/SymbolManager";
import { config } from "@/lib/config";
import { listSymbols } from "@/lib/db/symbols";
import { recipients } from "@/lib/jobs/notify";

export const dynamic = "force-dynamic";

export default async function SymbolsPage() {
  const [symbols, subscribers] = await Promise.all([listSymbols(), recipients()]);
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
