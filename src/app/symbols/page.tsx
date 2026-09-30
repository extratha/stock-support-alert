import { SymbolManager } from "@/components/SymbolManager";
import { config } from "@/lib/config";
import { listSymbols } from "@/lib/db/symbols";
import { recipients } from "@/lib/jobs/notify";

export const dynamic = "force-dynamic";

export default async function SymbolsPage() {
  const [symbols, subscribers] = await Promise.all([listSymbols(), recipients()]);
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">จัดการหุ้นที่ track</h1>
      <SymbolManager initial={symbols} max={config.maxTrackedSymbols()} subscribers={subscribers.length} />
    </div>
  );
}
