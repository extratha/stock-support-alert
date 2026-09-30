import { formatDateString } from "@/lib/format/datetime";
import { packBlocks } from "@/lib/line/text";
import type { LateEvent } from "./lateCheck";
import { METHOD_LABEL, TIER_LABEL_TH, type Method, type Tier } from "@/lib/support/types";

export interface AlertItem {
  symbol: string;
  tier: Tier;
  method: Method;
  price: number;
  level: number;
  /** Set in once-a-day mode: the day's low, which may be what actually touched the level. */
  dayLow?: number;
}

const usd = (n: number) => `$${n.toFixed(2)}`;

/**
 * Thai LINE text for the alerts triggered in one run. Everything goes into a single
 * message when it fits (saves push quota); only very large batches spill into more.
 */
export function formatAlertMessages(items: AlertItem[], timeLabel: string): string[] {
  const blocks = items.map((a) => {
    const diff = ((a.price - a.level) / a.level) * 100;
    const diffText = `${diff >= 0 ? "+" : ""}${diff.toFixed(2)}%`;
    return [
      `${a.symbol} แตะ "${TIER_LABEL_TH[a.tier]}"`,
      `• ราคาปัจจุบัน: ${usd(a.price)}`,
      `• แนวรับ: ${usd(a.level)} (${METHOD_LABEL[a.method]})`,
      `• ห่างจากแนวรับ: ${diffText}`,
      ...(a.dayLow !== undefined ? [`• ต่ำสุดวันนี้: ${usd(a.dayLow)}`] : []),
    ].join("\n");
  });
  return packBlocks(blocks, { header: `🔔 แจ้งเตือนแนวรับหุ้น US · ${timeLabel}\n` });
}

/** A late event plus what replaces the level from tomorrow (null = no level of that tier below the price any more). */
export type LateItem = LateEvent & { next: { price: number; method: Method } | null };

/** The after-close summary: touches the 13:30 check could not see, and levels the price closed under. */
export function formatLateMessages(items: LateItem[]): string[] {
  const blocks = items.map((e) => {
    const tier = TIER_LABEL_TH[e.tier];
    const level = `${usd(e.level)} (${METHOD_LABEL[e.method]})`;
    const below = ((e.close - e.level) / e.level) * 100;
    const lines = e.broke
      ? [`${e.symbol} หลุด "${tier}" ${level}`, `• ต่ำสุด ${usd(e.low)} · ปิด ${usd(e.close)} (${below.toFixed(1)}% จากแนวรับ)`]
      : [`${e.symbol} แตะ "${tier}" ${level} หลังรอบเช็ก`, `• ต่ำสุด ${usd(e.low)} · ปิด ${usd(e.close)}`];
    lines.splice(1, 0, `• วันที่ ${formatDateString(e.date)}`);
    if (e.broke) {
      lines.push(e.next ? `• ${tier}ใหม่: ${usd(e.next.price)} (${METHOD_LABEL[e.next.method]})` : `• ไม่มี${tier}ที่ต่ำกว่านี้แล้ว`);
    }
    return lines.join("\n");
  });
  return packBlocks(blocks, { header: "📉 สรุปหลังตลาดปิด\n" });
}
