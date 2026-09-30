import { packBlocks } from "@/lib/line/text";
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
