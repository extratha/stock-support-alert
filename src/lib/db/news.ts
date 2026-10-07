import type { ArticleText } from "@/lib/news/extract";
import type { RawArticle } from "@/lib/news/finnhub";
import { tidy } from "@/lib/news/parse";
import type { NewsBriefView, NewsPoint, NewsRef, StockNews } from "@/lib/news/types";
import { sql } from "./client";

// --- company names -------------------------------------------------------------------------------------------------

export interface CompanyName {
  symbol: string;
  name: string | null;
  checkedAt: Date | null;
}

export async function listCompanyNames(): Promise<CompanyName[]> {
  return sql()<CompanyName[]>`
    select symbol, company_name as name, company_name_checked_at as "checkedAt" from symbols order by position nulls last, symbol`;
}

/** `name` null = Finnhub has none; the check time stops the job from asking again every hour. */
export async function saveCompanyName(symbol: string, name: string | null) {
  await sql()`update symbols set company_name = coalesce(${name}, company_name), company_name_checked_at = now() where symbol = ${symbol}`;
}

// --- articles ------------------------------------------------------------------------------------------------------

/**
 * Adds articles not seen before; for ones already stored, adds any tracked symbol they were not filed under yet (the
 * same article is listed under several tickers). Returns how many were new.
 */
export async function saveArticles(articles: RawArticle[]): Promise<number> {
  // one entry per key, symbols merged (the same article comes back for several tickers in one run)
  const byKey = new Map<string, RawArticle>();
  for (const a of articles) {
    const seen = byKey.get(a.key);
    if (seen) seen.symbols = [...new Set([...seen.symbols, ...a.symbols])];
    else byKey.set(a.key, { ...a, symbols: [...a.symbols] });
  }
  if (byKey.size === 0) return 0;

  const db = sql();
  const existing = await db<{ key: string; symbols: string[] }[]>`select key, symbols from news_articles where key = any(${[...byKey.keys()]})`;
  const stored = new Map(existing.map((r) => [r.key, r.symbols]));
  const fresh = [...byKey.values()].filter((a) => !stored.has(a.key));
  let added = 0;
  if (fresh.length > 0) {
    // one statement for the lot (symbols travel comma-joined: a list of lists does not fit unnest; market news has none)
    const rows = await db`
      insert into news_articles (key, scope, symbols, source, headline, summary, url, published_at)
      select k, sc, coalesce(string_to_array(nullif(sy, ''), ','), '{}'), so, h, su, u, p
      from unnest(${fresh.map((a) => a.key)}::text[], ${fresh.map((a) => a.scope)}::text[], ${fresh.map((a) => a.symbols.join(","))}::text[],
                  ${fresh.map((a) => a.source)}::text[], ${fresh.map((a) => a.headline)}::text[], ${fresh.map((a) => a.summary)}::text[],
                  ${fresh.map((a) => a.url)}::text[], ${fresh.map((a) => a.publishedAt.toISOString())}::timestamptz[])
        as t(k, sc, sy, so, h, su, u, p)
      on conflict (key) do nothing returning id`;
    added = rows.length;
  }
  for (const a of byKey.values()) {
    const had = stored.get(a.key);
    if (had !== undefined && a.symbols.some((s) => !had.includes(s))) {
      await db`
        update news_articles set symbols = array(select distinct unnest(symbols || ${a.symbols}::text[]))
        where key = ${a.key}`;
    }
  }
  return added;
}

export interface PendingArticle {
  id: number;
  url: string;
  source: string;
  headline: string;
  summary: string;
}

/** Newest first: the articles whose text has not been read yet. */
export async function articlesWithoutBody(since: Date, limit: number): Promise<PendingArticle[]> {
  return sql()<PendingArticle[]>`
    select id::int as id, url, source, headline, summary from news_articles
    where body_status is null and published_at >= ${since}
    order by published_at desc limit ${limit}`;
}

export async function saveBody(id: number, r: ArticleText) {
  await sql()`
    update news_articles set body = ${r.text}, body_status = ${r.status}, final_url = ${r.finalUrl}, fetched_at = now()
    where id = ${id}`;
}

export interface StoredArticle {
  id: number;
  scope: "company" | "market";
  symbols: string[];
  source: string;
  headline: string;
  summary: string;
  url: string;
  finalUrl: string | null;
  publishedAt: Date;
  body: string | null;
}

export async function articlesBetween(from: Date, to: Date): Promise<StoredArticle[]> {
  return sql()<StoredArticle[]>`
    select id::int as id, scope, symbols, source, headline, summary, url, final_url as "finalUrl",
           published_at as "publishedAt", body
    from news_articles where published_at >= ${from} and published_at <= ${to}
    order by published_at desc`;
}

/** Article text is only needed until it has been summarised; old rows go entirely. */
export async function purgeOldNews(): Promise<{ cleared: number; deleted: number }> {
  const db = sql();
  const cleared = await db`update news_articles set body = null where body is not null and published_at < now() - interval '7 days' returning id`;
  const deleted = await db`delete from news_articles where published_at < now() - interval '30 days' returning id`;
  return { cleared: cleared.length, deleted: deleted.length };
}

// --- briefs --------------------------------------------------------------------------------------------------------

/** What is stored in `result` when a brief succeeds. */
export interface StoredBrief {
  market: { summary: string; points: NewsPoint[] };
  stocks: StockNews[];
  quiet: string[];
  caveats: string[];
  refs: NewsRef[];
  skipped?: { model: string; reason: string }[];
}

/** Reserve a brief for `day`, atomically limited to `limit` per day. Returns the id, or null when the limit is used up. */
export async function startBrief(day: string, trigger: "schedule" | "manual", model: string, limit: number): Promise<number | null> {
  const rows = await sql()<{ id: number }[]>`
    insert into news_briefs (day, trigger, model)
    select ${day}::date, ${trigger}::text, ${model}::text
    where (select count(*) from news_briefs where day = ${day}::date) < ${limit}::int
    returning id::int as id`;
  return rows[0]?.id ?? null;
}

export async function finishBrief(id: number, o: { model: string; windowFrom: Date; windowTo: Date; result: StoredBrief }) {
  const db = sql();
  await db`
    update news_briefs set status = 'ok', model = ${o.model}, window_from = ${o.windowFrom}, window_to = ${o.windowTo},
                           result = ${db.json(o.result as never)}
    where id = ${id}`;
}

export async function cancelBrief(id: number) {
  await sql()`delete from news_briefs where id = ${id}`;
}

export async function briefsOnDay(day: string): Promise<number> {
  const rows = await sql()<{ n: number }[]>`select count(*)::int as n from news_briefs where day = ${day}::date`;
  return rows[0]?.n ?? 0;
}

interface BriefRow {
  id: number;
  created_at: Date;
  trigger: string;
  model: string;
  window_from: Date | null;
  window_to: Date | null;
  result: StoredBrief | string | null;
}

const list = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

/** Tolerant of partial rows: the page must never crash because one stored result is odd. */
export function toBriefView(r: BriefRow): NewsBriefView {
  let result: Partial<StoredBrief> = {};
  try {
    const raw = typeof r.result === "string" ? (JSON.parse(r.result) as unknown) : r.result;
    if (raw && typeof raw === "object") result = raw as Partial<StoredBrief>;
  } catch {
    // unreadable: shown as an empty brief
  }
  // tidy: briefs saved before the parser removed citation numbers from the text
  const text = (v: unknown) => (typeof v === "string" ? tidy(v).trim() : "");
  const points = (v: unknown) => list<NewsPoint>(v).map((p) => ({ ...p, text: text(p.text), sources: list<number>(p.sources) }));
  return {
    id: r.id,
    createdAt: r.created_at.toISOString(),
    trigger: r.trigger === "schedule" ? "schedule" : "manual",
    model: r.model,
    windowFrom: (r.window_from ?? r.created_at).toISOString(),
    windowTo: (r.window_to ?? r.created_at).toISOString(),
    market: { summary: text(result.market?.summary), points: points(result.market?.points) },
    stocks: list<StockNews>(result.stocks).map((s) => ({ ...s, summary: text(s.summary), points: points(s.points) })),
    quiet: list<string>(result.quiet),
    caveats: list<string>(result.caveats),
    refs: list<NewsRef>(result.refs),
    skipped: list<{ model: string; reason: string }>(result.skipped),
  };
}

export async function latestBrief(): Promise<NewsBriefView | null> {
  const rows = await sql()<BriefRow[]>`
    select id::int as id, created_at, trigger, model, window_from, window_to, result
    from news_briefs where status = 'ok' order by id desc limit 1`;
  return rows[0] ? toBriefView(rows[0]) : null;
}

export async function getBrief(id: number): Promise<NewsBriefView | null> {
  const rows = await sql()<BriefRow[]>`
    select id::int as id, created_at, trigger, model, window_from, window_to, result
    from news_briefs where id = ${id} and status = 'ok'`;
  return rows[0] ? toBriefView(rows[0]) : null;
}
