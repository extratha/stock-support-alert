import type { ProfileData } from "@/lib/profile/describe";
import type { TrackedSymbol } from "@/lib/db/symbols";
import type { TrackSummary } from "@/lib/support/track";
import { METHOD_LABEL, type Method, type Tier } from "@/lib/support/types";
import { GOALS, MAX_PICKS, type GoalId } from "./types";

const DAY_MS = 86_400_000;
const round = (n: number | null | undefined, digits = 1): number | null =>
  n === null || n === undefined || !Number.isFinite(n) ? null : Number(n.toFixed(digits));

export interface StockInput {
  symbol: string;
  price: number | null;
  fundamentals: {
    pe: number | null;
    forwardPe: number | null;
    revenueGrowthPct: number | null;
    netMarginPct: number | null;
    dividendYieldPct: number | null;
    beta: number | null;
  };
  risk: {
    high52w: number | null;
    /** price versus the 52-week high, percent (-12 = 12% below) */
    fromHigh52wPct: number | null;
    /** worst fall from a peak in the available history, percent (-66 = fell 66%) */
    maxDrawdownPct: number | null;
    daysToEarnings: number | null;
  };
  supportLevels: {
    tier: Tier;
    level: number;
    method: string;
    /** swing-low zones only */
    zoneLow: number | null;
    bounces: number | null;
    /** percent the price is above the level (negative = below it) */
    distanceAbovePct: number | null;
    /** how this stock's past touches of this tier went: held / total, versus a random level at the same distance */
    pastHeld: string | null;
    pastRandomHeldPct: number | null;
  }[];
  /** a support level that broke recently and the price is still under */
  recentBreak: { tier: Tier; level: number; date: string } | null;
  /** brokerage analysts' latest month of ratings and their average 12-month price target (opinions, often optimistic) */
  analysts: { buy: number; hold: number; sell: number; month: string; targetMean: number | null; targetVsPricePct: number | null } | null;
}

/** The facts the AI may use, per stock, computed from our own data (numbers only: nothing free-text reaches the prompt). */
export function buildStockInput(
  s: TrackedSymbol,
  price: number | null,
  profile: ProfileData | undefined,
  track: TrackSummary,
  today: string,
): StockInput {
  const p = profile;
  const high = p?.high52w ?? null;
  const earningsDays = p?.nextEarnings ? Math.round((Date.parse(`${p.nextEarnings}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / DAY_MS) : null;
  const brk = track.recentBreak;
  const stillBelow = brk !== null && price !== null && price < Math.min(brk.level, brk.zoneLow ?? brk.level);

  return {
    symbol: s.symbol,
    price: round(price, 2),
    fundamentals: {
      pe: round(p?.pe),
      forwardPe: round(p?.forwardPe),
      revenueGrowthPct: round(p?.revenueGrowth),
      netMarginPct: round(p?.netMargin),
      dividendYieldPct: round(p?.dividendYield, 2),
      beta: round(p?.beta, 2),
    },
    risk: {
      high52w: round(high, 2),
      fromHigh52wPct: price !== null && high ? round((price / high - 1) * 100) : null,
      maxDrawdownPct: p?.maxDrawdown === undefined || p.maxDrawdown === null ? null : round(p.maxDrawdown * 100, 0),
      daysToEarnings: earningsDays !== null && earningsDays >= 0 ? earningsDays : null,
    },
    supportLevels: s.levels.map((l) => {
      const r = track.records[l.tier];
      const total = r.held + r.broken + r.unclear;
      return {
        tier: l.tier,
        level: round(l.price, 2)!,
        method: METHOD_LABEL[l.method as Method] ?? l.method,
        zoneLow: l.zoneLow !== null && l.zoneLow < l.price ? round(l.zoneLow, 2) : null,
        bounces: l.touches,
        distanceAbovePct: price !== null ? round(((price - l.price) / l.price) * 100) : null,
        pastHeld: total > 0 ? `${r.held}/${total}` : null,
        pastRandomHeldPct: total > 0 ? round((r.expectedHeld / total) * 100, 0) : null,
      };
    }),
    recentBreak: brk !== null && stillBelow ? { tier: brk.tier, level: round(brk.level, 2)!, date: brk.resolvedOn ?? brk.touchedOn } : null,
    analysts: analystsOf(p, price),
  };
}

/** What the AI may and may not do; shared by the in-app run and the prompt the user copies to a chat. */
const RULES = `You are a careful research assistant for ONE individual investor who already follows a short list of US stocks. From that list, pick the stocks most worth a closer look for a purchase NOW, given the investor's goals.

Rules:
- Use ONLY the JSON data you are given. Never invent figures, news, earnings results, ratings, or events. If a figure you would need is null, say it is unknown; do not guess.
- Do not predict future prices and do not promise returns. This is not financial advice. Rank by how well each stock FITS THE GOALS on the given data, and say what could go wrong.
- Support levels are reference prices where the price turned up before. The investor's own backtest found that buying at them has NOT been shown to beat buying on other days, so never present a level as a buy signal or a floor. Use them only to comment on where the price sits relative to them. "pastHeld" is how often this stock's past touches of that tier held, "pastRandomHeldPct" is the same rate for a random level at the same distance: a level only means something if pastHeld is clearly above it.
- "analysts" are brokerage analysts' ratings and average price target: opinions, not facts. They lean heavily to "buy" (sell ratings are rare) and targets are usually optimistic, so treat them as one weak input, mention them as opinions, and never as a predicted price.
- Be willing to pick fewer than ${MAX_PICKS} if fewer stocks really fit. Never pick a stock that is not in the data.
- Write in Thai. Keep each reason/risk to one short sentence that cites a number from the data.`;

/** The in-app run parses the reply, so it must be JSON. */
function analystsOf(p: ProfileData | undefined, price: number | null): StockInput["analysts"] {
  if (!p) return null;
  const buy = (p.recStrongBuy ?? 0) + (p.recBuy ?? 0);
  const hold = p.recHold ?? 0;
  const sell = (p.recSell ?? 0) + (p.recStrongSell ?? 0);
  const target = p.targetMean ?? null;
  if (!p.recPeriod && target === null) return null;
  return {
    buy,
    hold,
    sell,
    month: p.recPeriod ? p.recPeriod.slice(0, 7) : "",
    targetMean: round(target, 2),
    targetVsPricePct: target !== null && price !== null && price > 0 ? round((target / price - 1) * 100) : null,
  };
}

export const SYSTEM_PROMPT = `${RULES}

Reply with ONE JSON object and nothing else (no markdown fences), exactly in this shape:
{
  "summary": "2-3 Thai sentences: what the ranking favours and the main caution",
  "picks": [
    { "symbol": "TICKER", "rank": 1, "reasons": ["..."], "risks": ["..."], "entryNote": "one Thai sentence on the price versus the support levels" }
  ],
  "caveats": ["Thai sentences about data gaps or limits that affect this ranking"]
}
"picks" is ordered best first, at most ${MAX_PICKS}, each with 2-4 reasons and 1-3 risks.`;

/** The same rules for a person to paste into any AI chat (no API, no quota): asks for a readable Thai answer instead of JSON. */
export const MANUAL_PROMPT_RULES = `${RULES}

Answer in readable Thai: a 2-3 sentence summary, then the picks best first (at most ${MAX_PICKS}), each with 2-4 reasons, 1-3 risks and one sentence on the price versus its support levels, then the data gaps or limits that affect the ranking.`;

export function buildUserPrompt(goals: GoalId[], stocks: StockInput[], today: string): string {
  const goalText =
    goals.length === 0
      ? "- No specific goal chosen: judge the overall balance of growth, valuation and risk."
      : GOALS.filter((g) => goals.includes(g.id)).map((g) => `- ${g.prompt}`).join("\n");
  return `Today (New York date): ${today}. Prices are the latest available.

Investor goals (all together; a stock that fits several ranks higher):
${goalText}

Stocks (JSON):
${JSON.stringify(stocks)}`;
}
