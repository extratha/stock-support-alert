import { TierBadge } from "@/components/TierBadge";
import { DEFAULT_RULES } from "@/lib/alerts/evaluate";
import { listTrackedSymbols } from "@/lib/db/symbols";
import { METHOD_LABEL, type Method } from "@/lib/support/types";

export const dynamic = "force-dynamic";

const usd = (n: number) => `$${n.toFixed(2)}`;
const time = (d: Date) =>
  new Intl.DateTimeFormat("th-TH", { timeZone: "Asia/Bangkok", dateStyle: "short", timeStyle: "short" }).format(d);

export default async function DashboardPage() {
  const stocks = await listTrackedSymbols();

  if (stocks.length === 0) {
    return (
      <p className="text-muted">
        ยังไม่มีหุ้นที่ track — ไปที่ <a className="underline" href="/symbols">จัดการหุ้น</a> เพื่อเพิ่ม symbol
      </p>
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">แนวรับปัจจุบัน</h1>
      <div className="grid gap-4 md:grid-cols-2">
        {stocks.map((s) => (
          <section key={s.symbol} className="rounded-xl border border-border bg-card p-4">
            <div className="flex items-baseline justify-between">
              <h2 className="text-lg font-semibold">{s.symbol}</h2>
              <div className="text-right">
                <div className="text-lg font-mono">{s.price !== null ? usd(s.price) : "—"}</div>
                <div className="text-xs text-muted">
                  {s.quoteTime ? `ราคา ณ ${time(s.quoteTime)}` : "ยังไม่มีราคา (รอรอบเช็คถัดไป)"}
                </div>
              </div>
            </div>

            {s.levels.length === 0 ? (
              <p className="mt-3 text-sm text-muted">ยังไม่มีแนวรับ</p>
            ) : (
              <table className="mt-3 w-full text-sm">
                <tbody>
                  {s.levels.map((l) => {
                    const dist = s.price !== null ? ((s.price - l.price) / l.price) * 100 : null;
                    const touched = s.price !== null && s.price <= l.price * (1 + DEFAULT_RULES.touchTolerance);
                    return (
                      <tr key={l.tier} className="border-t border-border">
                        <td className="py-2"><TierBadge tier={l.tier} /></td>
                        <td className="py-2 font-mono">{usd(l.price)}</td>
                        <td className="py-2 text-muted">{METHOD_LABEL[l.method as Method] ?? l.method}</td>
                        <td className="py-2 text-right font-mono">
                          {touched ? (
                            <span className="font-semibold text-red-500">แตะแล้ว</span>
                          ) : dist !== null ? (
                            <span className={dist < 2 ? "text-amber-500" : "text-muted"}>+{dist.toFixed(1)}%</span>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
            {s.asOf && <p className="mt-2 text-xs text-muted">คำนวณจากข้อมูลถึง {s.asOf} (close {usd(s.refClose ?? 0)})</p>}
          </section>
        ))}
      </div>
    </div>
  );
}
