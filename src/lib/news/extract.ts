import { Readability } from "@mozilla/readability";
import http from "node:http";
import https from "node:https";
import { parseHTML } from "linkedom";

/**
 * Reads the text of a news article from the publisher's page, the way a browser's reader view does (Mozilla
 * Readability). Best effort: paywalls, bot protection and pages that load the text with JavaScript give no text, and the
 * brief then uses the headline and Finnhub's summary instead. No attempt is made to get around a block.
 */

type BodyStatus = "ok" | "short" | "blocked" | "error" | "skipped";

export interface ArticleText {
  status: BodyStatus;
  text: string | null;
  finalUrl: string | null;
}

/** Says who is asking; publishers that refuse it are simply skipped. */
const USER_AGENT = "Mozilla/5.0 (compatible; stock-support-alert/1.0; personal news reader)";
const TIMEOUT_MS = 8000;
const MAX_HTML_BYTES = 4_000_000;
const MAX_HEADER_BYTES = 256 * 1024;
/** Stored text is capped: the prompt uses at most a few thousand characters of each article anyway. */
const MAX_BODY_CHARS = 20_000;
/** Less than this is a teaser or a cookie wall, not the article. */
const MIN_WORDS = 120;

/** Sources Finnhub lists that always refuse automated readers: not worth a request. */
const BLOCKING_SOURCES = new Set(["seekingalpha", "benzinga"]);

export const skipsFullText = (source: string) => BLOCKING_SOURCES.has(source.toLowerCase().replace(/[^a-z]/g, ""));

/** The article text from a page's HTML, or null when nothing article-like is found. Whitespace collapsed, capped. */
export function articleText(html: string): string | null {
  const { document } = parseHTML(html);
  const article = new Readability(document as unknown as Document).parse();
  const text = (article?.textContent ?? "").replace(/\s+/g, " ").trim();
  return text ? text.slice(0, MAX_BODY_CHARS) : null;
}

interface Page {
  status: number;
  url: string;
  contentType: string;
  /** null when the page was larger than MAX_HTML_BYTES */
  html: string | null;
}

/**
 * GET with redirects, a size cap and a time limit. Not `fetch`: Node's fetch refuses responses with more than 16 KB of
 * headers, and Yahoo Finance (most of Finnhub's articles) sends more than that.
 */
function getPage(url: string, deadline: number, redirects = 5): Promise<Page> {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    if (target.protocol !== "https:" && target.protocol !== "http:") return reject(new Error(`unsupported URL ${target.protocol}`));
    const client = target.protocol === "https:" ? https : http;
    const req = client.get(
      target,
      { headers: { "User-Agent": USER_AGENT, Accept: "text/html,application/xhtml+xml" }, maxHeaderSize: MAX_HEADER_BYTES, timeout: Math.max(1, deadline - Date.now()) },
      (res) => {
        const status = res.statusCode ?? 0;
        const location = res.headers.location;
        if (status >= 300 && status < 400 && location) {
          res.resume();
          if (redirects === 0) return reject(new Error("too many redirects"));
          return getPage(new URL(location, target).toString(), deadline, redirects - 1).then(resolve, reject);
        }
        const contentType = String(res.headers["content-type"] ?? "");
        if (status !== 200 || !contentType.includes("html")) {
          res.resume();
          return resolve({ status, url: target.toString(), contentType, html: null });
        }
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > MAX_HTML_BYTES) {
            res.destroy();
            resolve({ status, url: target.toString(), contentType, html: null });
          } else chunks.push(chunk);
        });
        res.on("end", () => resolve({ status, url: target.toString(), contentType, html: Buffer.concat(chunks).toString("utf8") }));
        res.on("error", reject);
      },
    );
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", reject);
  });
}

/**
 * Finnhub's news links (finnhub.io/api/news?id=...) redirect to the publisher. The redirector refuses bursts (429 or a
 * dropped connection when several are asked at once), so links are resolved one at a time. `null` = not now (try again
 * on the next run); otherwise the publisher's URL (the link itself when it is not a Finnhub link).
 */
export async function resolveLink(url: string): Promise<string | null> {
  if (!/^https:\/\/finnhub\.io\//.test(url)) return url;
  try {
    const res = await fetch(url, { redirect: "manual", cache: "no-store", signal: AbortSignal.timeout(TIMEOUT_MS) });
    await res.body?.cancel().catch(() => {});
    const location = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && location) return new URL(location, url).toString();
    return null;
  } catch {
    return null;
  }
}

export async function fetchArticleText(url: string): Promise<ArticleText> {
  let page: Page;
  try {
    page = await getPage(url, Date.now() + TIMEOUT_MS);
  } catch {
    return { status: "error", text: null, finalUrl: null };
  }
  if (page.status === 401 || page.status === 403 || page.status === 429) return { status: "blocked", text: null, finalUrl: page.url };
  if (page.status !== 200 || !page.contentType.includes("html")) return { status: "error", text: null, finalUrl: page.url };
  try {
    const text = page.html ? articleText(page.html) : null;
    if (!text || text.split(" ").length < MIN_WORDS) return { status: "short", text: null, finalUrl: page.url };
    return { status: "ok", text, finalUrl: page.url };
  } catch {
    return { status: "error", text: null, finalUrl: page.url };
  }
}
