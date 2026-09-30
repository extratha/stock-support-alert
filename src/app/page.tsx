import Link from "next/link";
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

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">แนวรับปัจจุบัน</h1>
        <p className="mt-1 text-sm text-muted">กำลัง track {stocks.length} ตัว · ข้อมูลจากรอบเช็คล่าสุด</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {stocks.map((s) => (
          <section key={s.symbol} className="surface p-5">
            <div className="flex items-start justify-between gap-4">
              <h2 className="font-mono text-xl font-semibold tracking-wide">{s.symbol}</h2>
              <div className="text-right">
                <div className="font-mono text-xl font-medium tabular-nums">{s.price !== null ? usd(s.price) : "—"}</div>
                <div className="text-xs text-muted">
                  {s.quoteTime ? `ราคา ณ ${time(s.quoteTime)}` : "ยังไม่มีราคา (รอรอบเช็คถัดไป)"}
                </div>
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
                    <li key={l.tier} className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1 px-3 py-2.5 sm:grid-cols-[9.5rem_1fr_auto]">
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
            {s.asOf && (
              <p className="mt-3 text-xs text-muted">
                คำนวณจากข้อมูลถึง {s.asOf} (close <span className="font-mono">{usd(s.refClose ?? 0)}</span>)
              </p>
            )}
          </section>
        ))}
      </div>
    </div>
  );
}
