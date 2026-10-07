import { matcher, namesFor, relevance } from "./relevance";
import type { NewsRef } from "./types";

/** An article as the brief sees it (a stored row, or a test fixture). */
export interface BriefArticle {
  scope: "company" | "market";
  source: string;
  headline: string;
  summary: string;
  url: string;
  finalUrl: string | null;
  publishedAt: Date;
  body: string | null;
}

export interface TrackedName {
  symbol: string;
  companyName: string | null;
}

interface PromptArticle extends NewsRef {
  text: string;
}

export interface Selection {
  articles: PromptArticle[];
  /** tracked stocks with no article about them */
  quiet: string[];
}

export interface SelectOptions {
  /** most articles per stock (the most relevant, then the newest) */
  perStock: number;
  /** most market-wide articles (newest) */
  market: number;
  /** characters of article text in the whole prompt (the provider's context and per-minute token limits) */
  maxChars: number;
}

export const DEFAULT_SELECT: SelectOptions = { perStock: 6, market: 15, maxChars: 160_000 };

const COMPANY_TEXT_CHARS = 4000;
const MARKET_TEXT_CHARS = 1500;
const MIN_TEXT_CHARS = 600;
const sameStory = (h: string) => h.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/**
 * Picks what the AI reads. Every article is matched against EVERY tracked stock (not only the ticker Finnhub filed it
 * under), so a TSMC article that discusses Nvidia counts for both, and one filed under a ticker it never names counts
 * for none. Opinion pieces are kept: the reader judges them; the AI labels them as opinion.
 */
export function selectArticles(all: BriefArticle[], tracked: TrackedName[], opts: SelectOptions = DEFAULT_SELECT): Selection {
  const matchers = tracked.map((t) => ({ symbol: t.symbol, count: matcher(t.symbol, namesFor(t.symbol, t.companyName)) }));
  const scored = all.map((a) => ({
    a,
    scores: new Map(matchers.map((m) => [m.symbol, relevance(m.count, a)] as const).filter(([, s]) => s > 0)),
  }));

  const chosen = new Set<(typeof scored)[number]>();
  const stories = new Set<string>();
  const take = (x: (typeof scored)[number]) => {
    const story = sameStory(x.a.headline);
    if (chosen.has(x) || stories.has(story)) return false;
    chosen.add(x);
    stories.add(story);
    return true;
  };

  const newest = (a: { a: BriefArticle }, b: { a: BriefArticle }) => b.a.publishedAt.getTime() - a.a.publishedAt.getTime();
  scored
    .filter((x) => x.a.scope === "market")
    .sort(newest)
    .slice(0, opts.market)
    .forEach(take);

  const quiet: string[] = [];
  for (const { symbol } of matchers) {
    const mine = scored.filter((x) => x.scores.has(symbol)).sort((a, b) => b.scores.get(symbol)! - a.scores.get(symbol)! || newest(a, b));
    let n = [...chosen].filter((x) => x.scores.has(symbol)).length;
    for (const x of mine) {
      if (n >= opts.perStock) break;
      if (!chosen.has(x) && take(x)) n++;
    }
    if (n === 0) quiet.push(symbol);
  }

  // market news first (context for everything else), then by stock in the tracked order, newest first within each
  const order = (x: (typeof scored)[number]) => {
    const i = matchers.findIndex((m) => x.scores.has(m.symbol));
    return i < 0 ? -1 : i;
  };
  const picked = [...chosen].sort((a, b) => order(a) - order(b) || newest(a, b));

  // shrink every article's share until the whole set fits the budget
  const capOf = (x: (typeof scored)[number]) => (x.scores.size === 0 ? MARKET_TEXT_CHARS : COMPANY_TEXT_CHARS);
  const fullOf = (x: (typeof scored)[number]) => x.a.body ?? x.a.summary;
  let scale = 1;
  const total = () => picked.reduce((sum, x) => sum + Math.min(fullOf(x).length, Math.max(MIN_TEXT_CHARS, Math.floor(capOf(x) * scale))), 0);
  while (scale > 0.15 && total() > opts.maxChars) scale *= 0.8;

  const articles = picked.map((x, i): PromptArticle => {
    const limit = Math.max(MIN_TEXT_CHARS, Math.floor(capOf(x) * scale));
    const text = fullOf(x);
    return {
      n: i + 1,
      headline: x.a.headline,
      source: x.a.source,
      url: x.a.finalUrl ?? x.a.url,
      publishedAt: x.a.publishedAt.toISOString(),
      fullText: x.a.body !== null,
      symbols: matchers.filter((m) => x.scores.has(m.symbol)).map((m) => m.symbol),
      text: text.length > limit ? `${text.slice(0, limit)}…` : text,
    };
  });
  return { articles, quiet };
}

export const NEWS_SYSTEM_PROMPT = `You read news for ONE individual investor who follows a short list of US stocks, and explain how the news could affect those stocks and the market. You get numbered articles: the full text when it could be read, otherwise only the headline and a short summary.

Rules:
- Use ONLY the articles given. Never add facts, figures or events from memory. If the articles disagree, say so.
- Every point cites the numbers of the articles it comes from in "sources".
- Label every point: "fact" = something the article reports happened (results, a deal, a rule, a price move); "opinion" = a writer's, analyst's or newsletter's view or recommendation (e.g. "Is X a buy?", price targets, ratings); "inference" = your own reasoning beyond the articles, e.g. that news about a supplier, customer or competitor matters for a tracked stock. Opinion pieces are kept on purpose: report what they argue, labelled as opinion, without endorsing them.
- "direction" is how the news as a whole reads for the stock: positive, negative, mixed or neutral. "impact" is how much it could matter for the share price beyond everyday noise: high (results, guidance, big contracts, regulation, export rules, lawsuits, management change, large market moves), medium, or low (commentary, rehashes, lists, routine items).
- Many articles are written after the price has already moved. When an article reports a price move, say that it already happened.
- Do not predict prices or give buy/sell advice. Explain what happened and why it might matter.
- Write in Thai. Keep company names, tickers, product names and numbers as in the article. Do not write article numbers or the labels into the text: they go in "sources" and "kind".

Reply with ONE JSON object and nothing else (no markdown fences), exactly in this shape:
{
  "market": { "summary": "2-3 Thai sentences on the market-wide news (rates, inflation, jobs, oil, geopolitics, sector moves) and what it means for these stocks; empty if none", "points": [ { "text": "...", "kind": "fact", "sources": [1] } ] },
  "stocks": [
    { "symbol": "TICKER", "direction": "positive", "impact": "high", "summary": "1-2 Thai sentences", "points": [ { "text": "one Thai sentence", "kind": "fact", "sources": [3, 4] } ] }
  ],
  "caveats": ["Thai sentences about gaps: e.g. key articles were headline-only"]
}
Include every stock that has articles about it, most important first, each with 1-5 points. Market points: at most 5.`;

const utc = (iso: string) => `${iso.slice(0, 16).replace("T", " ")} UTC`;

export function buildNewsPrompt(sel: Selection, tracked: TrackedName[], from: Date, to: Date): string {
  const names = tracked.map((t) => (t.companyName ? `${t.symbol} (${t.companyName})` : t.symbol)).join(", ");
  const bySymbol = tracked
    .map((t) => `${t.symbol}: ${sel.articles.filter((a) => a.symbols.includes(t.symbol)).map((a) => a.n).join(", ") || "none"}`)
    .join("\n");
  const body = sel.articles
    .map(
      (a) =>
        `[${a.n}] ${a.source} · ${utc(a.publishedAt)} · ${a.symbols.length > 0 ? `about: ${a.symbols.join(", ")}` : "market news"}\n` +
        `HEADLINE: ${a.headline}\n${a.fullText ? "TEXT" : "SUMMARY ONLY (full text not available)"}: ${a.text}`,
    )
    .join("\n\n");
  return `News published between ${utc(from.toISOString())} and ${utc(to.toISOString())}.

Tracked stocks: ${names}

Articles about each stock (numbers):
${bySymbol}

Articles:

${body}`;
}
