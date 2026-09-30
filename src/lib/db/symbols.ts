import type { Tier } from "@/lib/support/types";
import { sql } from "./client";

export { SYMBOL_PATTERN } from "@/lib/symbol";

export async function listSymbols(): Promise<string[]> {
  const rows = await sql()<{ symbol: string }[]>`select symbol from symbols order by symbol`;
  return rows.map((r) => r.symbol);
}

export async function addSymbol(symbol: string): Promise<boolean> {
  const rows = await sql()`insert into symbols (symbol) values (${symbol}) on conflict do nothing returning symbol`;
  return rows.length > 0;
}

export async function removeSymbol(symbol: string): Promise<boolean> {
  const rows = await sql()`delete from symbols where symbol = ${symbol} returning symbol`;
  return rows.length > 0;
}

export interface TrackedSymbol {
  symbol: string;
  price: number | null;
  quoteTime: Date | null;
  asOf: string | null;
  refClose: number | null;
  levels: { tier: Tier; price: number; method: string }[];
}

/** Everything the dashboard needs, from cache only (no external API calls). */
export async function listTrackedSymbols(): Promise<TrackedSymbol[]> {
  const db = sql();
  const [symbols, levels, quotes] = await Promise.all([
    db<{ symbol: string }[]>`select symbol from symbols order by symbol`,
    db<{ symbol: string; tier: Tier; price: number; method: string; ref_close: number; as_of: string }[]>`
      select symbol, tier, price::float8 as price, method, ref_close::float8 as ref_close, as_of::text as as_of
      from support_levels`,
    db<{ symbol: string; price: number; quote_time: Date }[]>`
      select symbol, price::float8 as price, quote_time from quotes`,
  ]);

  const order: Record<Tier, number> = { minor: 0, intermediate: 1, major: 2 };
  return symbols.map(({ symbol }) => {
    const mine = levels.filter((l) => l.symbol === symbol).sort((a, b) => order[a.tier] - order[b.tier]);
    const quote = quotes.find((q) => q.symbol === symbol);
    return {
      symbol,
      price: quote?.price ?? null,
      quoteTime: quote?.quote_time ?? null,
      asOf: mine[0]?.as_of ?? null,
      refClose: mine[0]?.ref_close ?? null,
      levels: mine.map(({ tier, price, method }) => ({ tier, price, method })),
    };
  });
}
