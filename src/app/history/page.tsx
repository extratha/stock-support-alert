import { TierBadge } from "@/components/TierBadge";
import { listHistory } from "@/lib/db/alerts";
import { METHOD_LABEL, type Method } from "@/lib/support/types";

export const dynamic = "force-dynamic";

const usd = (n: number) => `$${n.toFixed(2)}`;
const time = (d: Date) =>
  new Intl.DateTimeFormat("th-TH", { timeZone: "Asia/Bangkok", dateStyle: "medium", timeStyle: "short" }).format(d);

export default async function HistoryPage() {
  const rows = await listHistory();
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">ประวัติการแจ้งเตือน</h1>
      {rows.length === 0 ? (
        <p className="text-muted">ยังไม่มีการแจ้งเตือน</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full text-sm">
            <thead className="bg-card text-left text-muted">
              <tr>
                <th className="p-3">เวลา (ไทย)</th>
                <th className="p-3">หุ้น</th>
                <th className="p-3">ระดับ</th>
                <th className="p-3">ราคา</th>
                <th className="p-3">แนวรับ</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-border">
                  <td className="p-3 whitespace-nowrap">{time(r.sentAt)}</td>
                  <td className="p-3 font-semibold">{r.symbol}</td>
                  <td className="p-3"><TierBadge tier={r.tier} /></td>
                  <td className="p-3 font-mono">{usd(r.price)}</td>
                  <td className="p-3 font-mono">
                    {usd(r.level)} <span className="text-muted">({METHOD_LABEL[r.method as Method] ?? r.method})</span>
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
