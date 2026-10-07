import { AnalysisParseError } from "@/lib/analysis/parse";
import { DIRECTIONS, IMPACTS, POINT_KINDS, type Direction, type Impact, type NewsPoint, type PointKind, type StockNews } from "./types";

export interface ParsedBrief {
  market: { summary: string; points: NewsPoint[] };
  stocks: StockNews[];
  caveats: string[];
}

/** Citation numbers ("[16]", "[18, 24]") and labels ("(Opinion)") written into the text: the page shows both already. */
export const tidy = (v: string) =>
  v
    .replace(/\s*\[\d+(?:\s*,\s*\d+)*\]/g, "")
    .replace(/\s*\((?:opinion|fact|inference)\)/gi, "")
    .replace(/\s{2,}/g, " ");
const clip = (v: unknown, max: number): string => (typeof v === "string" ? tidy(v).trim().slice(0, max) : "");
const oneOf = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T =>
  typeof v === "string" && (allowed as readonly string[]).includes(v.trim().toLowerCase()) ? (v.trim().toLowerCase() as T) : fallback;

function extractJson(text: string): unknown {
  const unfenced = text.replace(/```(?:json)?/gi, "");
  const start = unfenced.indexOf("{");
  const end = unfenced.lastIndexOf("}");
  if (start < 0 || end <= start) throw new AnalysisParseError("คำตอบของ AI ไม่ใช่ JSON");
  try {
    return JSON.parse(unfenced.slice(start, end + 1));
  } catch {
    throw new AnalysisParseError("อ่านคำตอบของ AI ไม่ได้ (JSON ไม่สมบูรณ์)");
  }
}

function points(v: unknown, maxItems: number, articleCount: number): NewsPoint[] {
  return (Array.isArray(v) ? v : [])
    .map((item): NewsPoint | null => {
      const p = (item ?? {}) as Record<string, unknown>;
      const text = clip(p.text, 400);
      if (!text) return null;
      const sources = [...new Set((Array.isArray(p.sources) ? p.sources : []).map(Number))].filter(
        (n) => Number.isInteger(n) && n >= 1 && n <= articleCount,
      );
      // a point without a source the reader can check is the AI's own reasoning, whatever it called it
      const kind: PointKind = sources.length === 0 ? "inference" : oneOf(p.kind, POINT_KINDS, "fact");
      return { text, kind, sources };
    })
    .filter((p): p is NewsPoint => p !== null)
    .slice(0, maxItems);
}

/**
 * The AI's reply in a safe shape: only tracked symbols (once each), only article numbers that exist, known labels
 * (anything else becomes neutral / low), every text clipped.
 */
export function parseBrief(text: string, allowedSymbols: string[], articleCount: number): ParsedBrief {
  const raw = extractJson(text) as Record<string, unknown> | null;
  if (!raw || typeof raw !== "object" || !Array.isArray(raw.stocks)) throw new AnalysisParseError("คำตอบของ AI ไม่มีรายการหุ้น (stocks)");

  const allowed = new Map(allowedSymbols.map((s) => [s.toUpperCase(), s]));
  const seen = new Set<string>();
  const stocks: StockNews[] = [];
  for (const item of raw.stocks as unknown[]) {
    const s = (item ?? {}) as Record<string, unknown>;
    const symbol = typeof s.symbol === "string" ? allowed.get(s.symbol.trim().toUpperCase()) : undefined;
    if (!symbol || seen.has(symbol)) continue;
    seen.add(symbol);
    stocks.push({
      symbol,
      direction: oneOf<Direction>(s.direction, DIRECTIONS, "neutral"),
      impact: oneOf<Impact>(s.impact, IMPACTS, "low"),
      summary: clip(s.summary, 600),
      points: points(s.points, 5, articleCount),
    });
  }

  const market = (raw.market ?? {}) as Record<string, unknown>;
  return {
    market: { summary: clip(market.summary, 800), points: points(market.points, 5, articleCount) },
    stocks,
    caveats: (Array.isArray(raw.caveats) ? raw.caveats : []).map((c) => clip(c, 300)).filter(Boolean).slice(0, 5),
  };
}
