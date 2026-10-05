import { MAX_PICKS, type AnalysisPick } from "./types";

export class AnalysisParseError extends Error {}

export interface ParsedAnalysis {
  summary: string;
  picks: Omit<AnalysisPick, "price">[];
  caveats: string[];
}

const clip = (v: unknown, max: number): string => (typeof v === "string" ? v.trim().slice(0, max) : "");
const strings = (v: unknown, maxItems: number, maxLen: number): string[] =>
  (Array.isArray(v) ? v : []).map((x) => clip(x, maxLen)).filter(Boolean).slice(0, maxItems);

/** The first balanced-looking {...} in the reply: models sometimes wrap the JSON in fences or a sentence. */
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

/**
 * Turns the AI's reply into a safe shape. The AI can be wrong or ignore instructions, so: only symbols from the list
 * we sent are kept (case-insensitive, once each), at most MAX_PICKS, ordered by the rank it gave (array order breaks
 * ties), and every text is clipped. Nothing here trusts the AI's numbers: prices are added from our own data later.
 */
export function parseAnalysis(text: string, allowedSymbols: string[]): ParsedAnalysis {
  const raw = extractJson(text) as Record<string, unknown> | null;
  if (!raw || typeof raw !== "object" || !Array.isArray(raw.picks)) throw new AnalysisParseError("คำตอบของ AI ไม่มีรายการหุ้น (picks)");

  const allowed = new Map(allowedSymbols.map((s) => [s.toUpperCase(), s]));
  const seen = new Set<string>();
  const candidates: { symbol: string; rank: number; order: number; pick: Omit<AnalysisPick, "price" | "rank"> }[] = [];

  (raw.picks as unknown[]).forEach((item, order) => {
    const p = (item ?? {}) as Record<string, unknown>;
    const symbol = typeof p.symbol === "string" ? allowed.get(p.symbol.trim().toUpperCase()) : undefined;
    if (!symbol || seen.has(symbol)) return;
    seen.add(symbol);
    const rank = typeof p.rank === "number" && Number.isFinite(p.rank) ? p.rank : order + 1;
    candidates.push({
      symbol,
      rank,
      order,
      pick: { symbol, reasons: strings(p.reasons, 4, 300), risks: strings(p.risks, 3, 300), entryNote: clip(p.entryNote, 300) },
    });
  });

  if (candidates.length === 0) throw new AnalysisParseError("AI ไม่ได้เลือกหุ้นที่อยู่ในรายการเลย");
  const picks = candidates
    .sort((a, b) => a.rank - b.rank || a.order - b.order)
    .slice(0, MAX_PICKS)
    .map((c, i) => ({ rank: i + 1, ...c.pick }));

  return { summary: clip(raw.summary, 800), picks, caveats: strings(raw.caveats, 5, 300) };
}
