import { METHOD_LABEL, TIER_LABEL_TH, type Method, type Tier } from "@/lib/support/types";
import { formatDateTime } from "@/lib/format/datetime";
import { SYMBOL_PATTERN } from "@/lib/symbol";
import { packBlocks } from "./text";

export interface SupportCommand {
  /** Upper-cased tickers the user asked for; empty means "everything I track". */
  symbols: string[];
}

const TRIGGER = /^ขอแนวรับ\s*([\s\S]*)$/;

/**
 * "ขอแนวรับ"            -> all tracked symbols
 * "ขอแนวรับ nvda amd"   -> only those (space / comma separated, "หุ้น" filler ignored)
 * anything else         -> null (not a command)
 */
export function parseSupportCommand(text: string): SupportCommand | null {
  const match = TRIGGER.exec(text.trim());
  if (!match) return null;
  const symbols = match[1]
    .split(/[\s,]+/)
    .map((t) => t.toUpperCase())
    .filter((t) => SYMBOL_PATTERN.test(t));
  return { symbols: [...new Set(symbols)] };
}

export interface StockSnapshot {
  symbol: string;
  price: number | null;
  quoteTime: Date | null;
  levels: { tier: Tier; price: number; method: string }[];
}

const usd = (n: number) => `$${n.toFixed(2)}`;

/** Reply built purely from cached data (no external API calls); split into several messages if long. */
export function formatSupportReply(all: StockSnapshot[], requested: string[]): string[] {
  if (all.length === 0) return ["ยังไม่มีหุ้นที่ track — เพิ่มได้ที่หน้าเว็บ (จัดการหุ้น)"];

  const bySymbol = new Map(all.map((s) => [s.symbol, s]));
  const wanted = requested.length > 0 ? requested : all.map((s) => s.symbol);
  const blocks: string[] = [];
  const unknown: string[] = [];

  for (const symbol of wanted) {
    const s = bySymbol.get(symbol);
    if (!s) {
      unknown.push(symbol);
      continue;
    }
    const head = s.price !== null
      ? `${s.symbol} — ${usd(s.price)}${s.quoteTime ? ` (ราคา ณ ${formatDateTime(s.quoteTime)})` : ""}`
      : `${s.symbol} — ยังไม่มีราคา`;
    const lines = s.levels.length === 0
      ? ["• ยังไม่มีแนวรับ"]
      : s.levels.map((l) => {
          const dist = s.price !== null ? ` [${(((s.price - l.price) / l.price) * 100).toFixed(1)}% จากแนวรับ]` : "";
          return `• ${TIER_LABEL_TH[l.tier]}: ${usd(l.price)} (${METHOD_LABEL[l.method as Method] ?? l.method})${dist}`;
        });
    blocks.push([head, ...lines].join("\n"));
  }

  if (unknown.length > 0) blocks.push(`ไม่พบในรายการที่ track: ${unknown.join(", ")}`);
  return packBlocks(blocks, { header: "📊 แนวรับปัจจุบัน\n" });
}
