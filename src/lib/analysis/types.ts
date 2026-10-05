/** Shared by the server and the browser: plain data only, no imports from server code. */

export const GOALS = [
  {
    id: "growth",
    label: "เติบโต",
    hint: "รายได้โตเร็ว และนักวิเคราะห์คาดว่ากำไรจะเพิ่ม",
    prompt: "Growth: high revenue growth (revenueGrowthPct) and earnings expected to rise (forwardPe clearly below pe).",
  },
  {
    id: "dividend",
    label: "ปันผล",
    hint: "ผลตอบแทนปันผลสูงและน่าจะจ่ายต่อเนื่อง (หุ้นที่ไม่มีตัวเลขปันผลถือว่าไม่ตรงเป้าหมายนี้)",
    prompt:
      "Dividend income: meaningful dividendYieldPct that looks sustainable (positive net margin, not a yield inflated by a collapsed price). A stock with dividendYieldPct null does not fit this goal.",
  },
  {
    id: "value",
    label: "ราคาไม่แพง",
    hint: "P/E ไม่สูงเมื่อเทียบกำไร (ระวังหุ้นที่ถูกเพราะธุรกิจแย่)",
    prompt: "Valuation: reasonable pe / forwardPe for the quality of the business. Beware stocks that are cheap because the business is deteriorating.",
  },
  {
    id: "stable",
    label: "ความเสี่ยงต่ำ",
    hint: "ราคาแกว่งน้อย เคยลงลึกไม่มาก กำไรเป็นบวก",
    prompt: "Lower risk: low beta, shallow maxDrawdownPct, positive netMarginPct, no earnings announcement in the next few days.",
  },
  {
    id: "dip",
    label: "จังหวะใกล้แนวรับ",
    hint: "ราคาอยู่ใกล้ระดับแนวรับที่ยังไม่หลุด (ไม่เอาตัวที่เพิ่งหลุดแนวรับ)",
    prompt:
      "Entry timing: the price is close to a support level that has not broken (small distanceAbovePct on a level), and not far above its 52-week high. Skip stocks whose recentBreak is set.",
  },
] as const;

export type GoalId = (typeof GOALS)[number]["id"];
export const GOAL_IDS: readonly string[] = GOALS.map((g) => g.id);

/** Keeps only known goal ids, once each, in the fixed order of GOALS; null when the input is not a list of strings. */
export function parseGoals(input: unknown): GoalId[] | null {
  if (!Array.isArray(input) || !input.every((g) => typeof g === "string")) return null;
  const chosen = new Set(input);
  if ([...chosen].some((g) => !GOAL_IDS.includes(g))) return null;
  return GOALS.filter((g) => chosen.has(g.id)).map((g) => g.id);
}

export const MAX_PICKS = 5;

export interface AnalysisPick {
  rank: number;
  symbol: string;
  /** price used for the analysis (display; not from the AI) */
  price: number | null;
  reasons: string[];
  risks: string[];
  /** what the AI says about the price versus the support levels */
  entryNote: string;
}

export interface AnalysisView {
  id: number;
  /** ISO time */
  createdAt: string;
  model: string;
  goals: GoalId[];
  summary: string;
  picks: AnalysisPick[];
  caveats: string[];
  /** how many tracked stocks the AI looked at */
  universe: number;
}
