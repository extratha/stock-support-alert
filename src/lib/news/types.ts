/** Shared by the server and the browser: plain data only, no imports from server code. */

export const DIRECTIONS = ["positive", "negative", "mixed", "neutral"] as const;
export type Direction = (typeof DIRECTIONS)[number];
export const DIRECTION_LABEL: Record<Direction, string> = { positive: "บวก", negative: "ลบ", mixed: "ผสม", neutral: "กลาง ๆ" };

export const IMPACTS = ["high", "medium", "low"] as const;
export type Impact = (typeof IMPACTS)[number];
export const IMPACT_LABEL: Record<Impact, string> = { high: "กระทบมาก", medium: "ปานกลาง", low: "น้อย" };

/** fact = what the article reports happened; opinion = a writer's or analyst's view; inference = the AI's own reasoning (e.g. a peer's news) */
export const POINT_KINDS = ["fact", "opinion", "inference"] as const;
export type PointKind = (typeof POINT_KINDS)[number];
export const POINT_KIND_LABEL: Record<PointKind, string> = { fact: "ข้อเท็จจริง", opinion: "ความเห็น", inference: "AI ตีความ" };

/** An article the brief used, shown as its source link. */
export interface NewsRef {
  /** 1-based number the AI cites */
  n: number;
  headline: string;
  source: string;
  url: string;
  /** ISO time */
  publishedAt: string;
  /** false = only the headline and Finnhub's summary were available (paywall / bot block) */
  fullText: boolean;
  /** tracked stocks the article is about (empty = market news) */
  symbols: string[];
}

export interface NewsPoint {
  text: string;
  kind: PointKind;
  /** NewsRef.n values */
  sources: number[];
}

export interface StockNews {
  symbol: string;
  direction: Direction;
  impact: Impact;
  summary: string;
  points: NewsPoint[];
}

export interface NewsBriefView {
  id: number;
  /** ISO time */
  createdAt: string;
  trigger: "schedule" | "manual";
  model: string;
  /** ISO times: news published in this window */
  windowFrom: string;
  windowTo: string;
  market: { summary: string; points: NewsPoint[] };
  stocks: StockNews[];
  /** tracked stocks with no news in the window */
  quiet: string[];
  caveats: string[];
  refs: NewsRef[];
  skipped: { model: string; reason: string }[];
}
