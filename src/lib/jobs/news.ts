import { AiError, chat } from "@/lib/ai/client";
import { AnalysisParseError } from "@/lib/analysis/parse";
import { config } from "@/lib/config";
import { lastRunDay, markRun } from "@/lib/db/jobRuns";
import {
  articlesBetween,
  articlesWithoutBody,
  cancelBrief,
  finishBrief,
  getBrief,
  listCompanyNames,
  purgeOldNews,
  saveArticles,
  saveBody,
  saveCompanyName,
  startBrief,
  type StoredBrief,
} from "@/lib/db/news";
import { isTradingDay, lastCompletedSession, nyToday } from "@/lib/market/calendar";
import { fetchArticleText, resolveLink, skipsFullText } from "@/lib/news/extract";
import { FinnhubHttpError, fetchCompanyName, fetchCompanyNews, fetchMarketNews, type RawArticle } from "@/lib/news/finnhub";
import { parseBrief } from "@/lib/news/parse";
import { buildNewsPrompt, DEFAULT_SELECT, NEWS_SYSTEM_PROMPT, selectArticles, type TrackedName } from "@/lib/news/prompt";
import { matcher, namesFor } from "@/lib/news/relevance";
import { IMPACTS, type NewsBriefView, type StockNews } from "@/lib/news/types";

const HOUR_MS = 3_600_000;
/** Each run asks for the last two days, so a run that failed or was skipped leaves no gap. */
const LOOKBACK_MS = 48 * HOUR_MS;
/** Finnhub's free plan allows 60 calls a minute, shared with the live prices: about 50 a minute here at most. */
const FINNHUB_PAUSE_MS = 1200;
const NAMES_PER_RUN = 5;
const NAME_RECHECK_MS = 30 * 24 * HOUR_MS;
const BODY_CONCURRENCY = 6;
const BODIES_PER_RUN = 100;
/** The serverless function may run 300 s; whatever the AI needs comes out of this. */
const FUNCTION_BUDGET_MS = 290_000;
const MIN_AI_MS = 60_000;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export interface CollectResult {
  added: number;
  read: number;
  /** articles whose text could not be read (paywall, bot block, page built with JavaScript) */
  unread: number;
  names: string[];
  errors: Record<string, string>;
  purged?: { cleared: number; deleted: number };
}

/**
 * Hourly: new Finnhub news for every tracked stock and the market, then the text of each new article. Never throws for
 * one source; bounded by `budgetMs` (articles not read in time are read on the next run).
 */
export async function collectNews(now = new Date(), { budgetMs = 200_000 }: { budgetMs?: number } = {}): Promise<CollectResult> {
  const started = Date.now();
  const left = () => budgetMs - (Date.now() - started);
  const result: CollectResult = { added: 0, read: 0, unread: 0, names: [], errors: {} };
  const key = process.env.FINNHUB_API_KEY;
  if (!key) return { ...result, errors: { "*": "FINNHUB_API_KEY is not set" } };

  const tracked = await listCompanyNames();
  const since = new Date(now.getTime() - LOOKBACK_MS);
  const found: RawArticle[] = [];
  let limited = false;
  /** undefined = not asked (rate limit, out of time) or failed */
  const call = async <T>(label: string, work: () => Promise<T>): Promise<T | undefined> => {
    if (limited || left() < 30_000) return undefined;
    try {
      return await work();
    } catch (err) {
      if (err instanceof FinnhubHttpError && err.status === 429) limited = true; // the rest waits for the next run
      result.errors[label] = err instanceof Error ? err.message : String(err);
      return undefined;
    } finally {
      await sleep(FINNHUB_PAUSE_MS);
    }
  };

  // company names, once (they let "Nvidia" match an article that never writes NVDA)
  const unnamed = tracked.filter((t) => !t.name && (!t.checkedAt || now.getTime() - t.checkedAt.getTime() > NAME_RECHECK_MS)).slice(0, NAMES_PER_RUN);
  for (const t of unnamed) {
    const name = await call(`name ${t.symbol}`, () => fetchCompanyName(t.symbol, key));
    if (name === undefined) continue;
    await saveCompanyName(t.symbol, name);
    if (name) {
      t.name = name;
      result.names.push(t.symbol);
    }
  }

  found.push(...((await call("market", () => fetchMarketNews(since, key))) ?? []));
  for (const t of tracked) found.push(...((await call(t.symbol, () => fetchCompanyNews(t.symbol, since, now, key))) ?? []));
  result.added = await saveArticles(found);

  // The article text: articles that name a tracked stock up front first, newest first within each group. Links are
  // resolved one at a time (Finnhub's redirector refuses bursts) while up to BODY_CONCURRENCY pages download.
  const counts = tracked.map((t) => matcher(t.symbol, namesFor(t.symbol, t.name)));
  const named = (a: { headline: string; summary: string }) => counts.some((c) => c(`${a.headline} ${a.summary}`) > 0);
  const pending = (await articlesWithoutBody(since, BODIES_PER_RUN * 3))
    .map((a, order) => ({ a, order, first: named(a) }))
    .sort((x, y) => Number(y.first) - Number(x.first) || x.order - y.order)
    .slice(0, BODIES_PER_RUN)
    .map((x) => x.a);
  const downloads = new Set<Promise<void>>();
  const read = async (id: number, url: string) => {
    const text = await fetchArticleText(url);
    await saveBody(id, text);
    if (text.status === "ok") result.read++;
    else result.unread++;
  };
  for (const a of pending) {
    if (left() < 15_000) break;
    if (skipsFullText(a.source)) {
      await saveBody(a.id, { status: "skipped", text: null, finalUrl: null });
      continue;
    }
    const url = await resolveLink(a.url);
    if (url === null) break; // the redirector says "not now": the rest waits for the next run
    while (downloads.size >= BODY_CONCURRENCY) await Promise.race(downloads);
    const job = read(a.id, url).finally(() => downloads.delete(job));
    downloads.add(job);
  }
  await Promise.all(downloads);

  result.purged = await purgeOldNews().catch(() => undefined);
  return result;
}

export type NewsErrorCode = "not_configured" | "no_symbols" | "no_news" | "limit" | "timeout" | "ai" | "parse";

/** `message` is user-safe (shown on the page). */
export class NewsError extends Error {
  constructor(
    message: string,
    readonly code: NewsErrorCode,
  ) {
    super(message);
    this.name = "NewsError";
  }
}

/**
 * The news the brief covers: since the same time on the previous trading day, so a Monday brief covers the weekend
 * and the day after a holiday covers the holiday (at most 4 days).
 */
export function briefWindow(now: Date): { from: Date; to: Date } {
  const today = nyToday(now);
  const last = lastCompletedSession(now);
  const days = Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${last}T00:00:00Z`)) / (24 * HOUR_MS));
  return { from: new Date(now.getTime() - Math.min(4, Math.max(1, days)) * 24 * HOUR_MS), to: now };
}

const impactRank = (s: StockNews) => IMPACTS.indexOf(s.impact);

export interface BriefOptions {
  trigger: "schedule" | "manual";
  /** scheduled runs: run even on a non-trading day or a second time the same day */
  force?: boolean;
  now?: Date;
}

/**
 * Collect the latest news, have the AI explain how it bears on each tracked stock, and store the brief. The scheduled
 * run (before the open) happens once per trading day; `null` = nothing to do. A run counts toward NEWS_DAILY_LIMIT only
 * if it produced a brief.
 */
export async function runNewsBrief({ trigger, force = false, now = new Date() }: BriefOptions): Promise<NewsBriefView | null> {
  const started = Date.now();
  const missing = config.ai.missing();
  if (missing.length > 0) throw new NewsError(`ยังไม่ได้ตั้งค่า ${missing.join(", ")} ใน environment variables`, "not_configured");

  const day = nyToday(now);
  if (trigger === "schedule" && !force) {
    if (!isTradingDay(day)) return null;
    if ((await lastRunDay("news-brief")) === day) return null;
  }

  // fresh news first; a manual run keeps more of its time for the AI
  const collected = await collectNews(now, { budgetMs: trigger === "manual" ? 60_000 : 120_000 }).catch((err) => {
    console.error("news collect failed", err);
    return null;
  });
  if (collected) console.log("news collect", JSON.stringify(collected));

  const tracked: TrackedName[] = (await listCompanyNames()).map((t) => ({ symbol: t.symbol, companyName: t.name }));
  if (tracked.length === 0) throw new NewsError("ยังไม่มีหุ้นที่ track — เพิ่มที่หน้าจัดการหุ้นก่อน", "no_symbols");
  const { from, to } = briefWindow(now);
  const selection = selectArticles(await articlesBetween(from, to), tracked, {
    ...DEFAULT_SELECT,
    perStock: config.news.perStock(),
    maxChars: config.news.maxChars(),
  });
  if (selection.articles.length === 0) throw new NewsError("ไม่มีข่าวใหม่ในช่วงนี้ให้สรุป", "no_news");

  const models = config.ai.models();
  const id = await startBrief(day, trigger, models[0], config.news.dailyLimit());
  if (id === null) throw new NewsError(`สรุปข่าวครบ ${config.news.dailyLimit()} ครั้งของวันนี้แล้ว (ปรับได้ด้วย NEWS_DAILY_LIMIT)`, "limit");

  try {
    const timeoutMs = FUNCTION_BUDGET_MS - (Date.now() - started);
    if (timeoutMs < MIN_AI_MS) throw new AiError("เวลาไม่พอเรียก AI หลังเก็บข่าว ลองใหม่อีกครั้ง", "timeout");
    const reply = await chat({ system: NEWS_SYSTEM_PROMPT, user: buildNewsPrompt(selection, tracked, from, to), models, timeoutMs });
    const parsed = parseBrief(reply.text, tracked.map((t) => t.symbol), selection.articles.length);

    // stocks the AI skipped although they had articles still get their links
    const covered = new Set(parsed.stocks.map((s) => s.symbol));
    const withNews = tracked.map((t) => t.symbol).filter((s) => !selection.quiet.includes(s));
    const stocks = [
      ...parsed.stocks,
      ...withNews.filter((s) => !covered.has(s)).map((symbol): StockNews => ({ symbol, direction: "neutral", impact: "low", summary: "", points: [] })),
    ]
      .map((s, order) => ({ s, order }))
      .sort((a, b) => impactRank(a.s) - impactRank(b.s) || a.order - b.order)
      .map((x) => x.s);

    const result: StoredBrief = {
      market: parsed.market,
      stocks,
      quiet: selection.quiet,
      caveats: parsed.caveats,
      refs: selection.articles.map((a) => ({ n: a.n, headline: a.headline, source: a.source, url: a.url, publishedAt: a.publishedAt, fullText: a.fullText, symbols: a.symbols })),
      skipped: reply.skipped,
    };
    await finishBrief(id, { model: reply.model, windowFrom: from, windowTo: to, result });
    if (trigger === "schedule") await markRun("news-brief", day);
    const view = await getBrief(id);
    if (!view) throw new Error("news brief row missing after save");
    return view;
  } catch (err) {
    const error =
      err instanceof AnalysisParseError
        ? new NewsError(`${err.message} — ลองใหม่อีกครั้ง (หรือเลือกโมเดลที่ทำตามคำสั่งได้ดีกว่า)`, "parse")
        : err instanceof AiError
          ? new NewsError(err.message, err.kind === "timeout" ? "timeout" : "ai")
          : new NewsError("สรุปข่าวไม่สำเร็จ ลองใหม่อีกครั้ง", "ai");
    if (!(err instanceof AiError) && !(err instanceof AnalysisParseError)) console.error("news brief failed", err);
    await cancelBrief(id).catch((e) => console.error("could not give back the failed brief", e));
    throw error;
  }
}
