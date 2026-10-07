/**
 * Does an article really talk about a stock? Finnhub files many articles under a ticker that only name it in passing
 * (or not at all), so each article is matched against the ticker and the company's usual short name.
 */

const LEGAL_WORDS = new Set([
  "inc", "incorporated", "corp", "corporation", "co", "company", "ltd", "limited", "plc", "sa", "nv", "ag", "se", "holdings",
  "holding", "group", "class", "a", "b", "c", "adr", "the", "and", "&",
]);
/** First words too common to stand alone ("Advanced" Micro Devices, "Taiwan" Semiconductor...): use two words. */
const GENERIC_FIRST = new Set([
  "advanced", "american", "applied", "general", "international", "united", "taiwan", "first", "national", "global", "new",
  "micro", "super", "arm", "on", "meta", "bank", "data", "digital",
]);
/** Names people use that the official name does not contain. */
const ALIASES: Record<string, string[]> = {
  TSM: ["TSMC"],
  GOOGL: ["Google", "Alphabet"],
  GOOG: ["Google", "Alphabet"],
  META: ["Meta Platforms", "Facebook"],
  BRK_B: ["Berkshire"],
};

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The words that identify `symbol` in English text, e.g. NVDA + "NVIDIA Corp" -> ["NVDA", "NVIDIA"]. */
export function namesFor(symbol: string, companyName: string | null): string[] {
  const names = new Set<string>([symbol, ...(ALIASES[symbol.replace(/[.-]/g, "_")] ?? [])]);
  const words = (companyName ?? "")
    .replace(/[.,()]/g, " ")
    .split(/\s+/)
    .filter((w) => w && !LEGAL_WORDS.has(w.toLowerCase()));
  if (words.length > 0) {
    const first = words[0];
    const weak = GENERIC_FIRST.has(first.toLowerCase()) || first.length < 4;
    if (!weak) names.add(first);
    else if (words.length > 1) names.add(`${first} ${words[1]}`);
  }
  return [...names];
}

/** A matcher for whole words: the ticker in capitals (so "ARM" the word does not count), the names in any case. */
export function matcher(symbol: string, names: string[]): (text: string) => number {
  const patterns = names.map((n) =>
    n === symbol ? new RegExp(`(?<![A-Za-z0-9$])\\$?${escape(n)}(?![A-Za-z0-9])`, "g") : new RegExp(`(?<![A-Za-z0-9])${escape(n)}(?![A-Za-z0-9])`, "gi"),
  );
  return (text: string) => patterns.reduce((n, p) => n + (text.match(p)?.length ?? 0), 0);
}

/**
 * How strongly an article is about the stock: named in the headline counts most, then the summary, then how often the
 * text names it. 0 = not about it.
 */
export function relevance(count: (text: string) => number, a: { headline: string; summary: string; body: string | null }): number {
  const inHeadline = count(a.headline) > 0 ? 6 : 0;
  const inSummary = count(a.summary) > 0 ? 2 : 0;
  const inBody = a.body ? Math.min(count(a.body), 6) * 0.5 : 0;
  // one passing mention deep in a long article (a list of tickers, "related stocks") is not about the stock
  if (inHeadline === 0 && inSummary === 0 && inBody < 1) return 0;
  return inHeadline + inSummary + inBody;
}
