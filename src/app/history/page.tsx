import { TierBadge } from "@/components/TierBadge";
import { listHistory } from "@/lib/db/alerts";
import { formatDateTime } from "@/lib/format/datetime";
import { PAGE_DATA_TIMEOUT_MS, withTimeout } from "@/lib/timeout";
import { METHOD_LABEL, type Method } from "@/lib/support/types";

export const dynamic = "force-dynamic";
export const metadata = { title: "ประวัติการแจ้งเตือน", description: "ประวัติการแจ้งเตือนเมื่อราคาหุ้นแตะแนวรับ" };

const usd = (n: number) => `$${n.toFixed(2)}`;

export default async function HistoryPage() {
  const rows = await withTimeout(listHistory(), PAGE_DATA_TIMEOUT_MS, "load alert history");
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">ประวัติการแจ้งเตือน</h1>
        <p className="mt-1 text-sm text-muted">{rows.length > 0 ? `ล่าสุด ${rows.length} รายการ` : "รายการที่ส่งเข้า LINE จะแสดงที่นี่"}</p>
      </div>
      {rows.length === 0 ? (
        <div className="surface p-8 text-center text-muted">ยังไม่มีการแจ้งเตือน</div>
      ) : (
        <div className="surface overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-muted">
              <tr>
                <th className="px-4 py-3 font-medium">เวลา (ไทย)</th>
                <th className="px-4 py-3 font-medium">หุ้น</th>
                <th className="px-4 py-3 font-medium">ระดับ</th>
                <th className="px-4 py-3 font-medium">ราคา</th>
                <th className="px-4 py-3 font-medium">แนวรับ</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-border transition-colors duration-150 hover:bg-elevated/60">
                  <td className="whitespace-nowrap px-4 py-3 text-muted">{formatDateTime(r.sentAt)}</td>
                  <td className="px-4 py-3 font-mono font-semibold">{r.symbol}</td>
                  <td className="px-4 py-3"><TierBadge tier={r.tier} /></td>
                  <td className="px-4 py-3 font-mono tabular-nums">{usd(r.price)}</td>
                  <td className="px-4 py-3 font-mono tabular-nums">
                    {usd(r.level)} <span className="font-sans text-xs text-muted">({METHOD_LABEL[r.method as Method] ?? r.method})</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
