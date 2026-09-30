import type { Tier } from "@/lib/support/types";
import { mergeOrder } from "@/lib/symbolOrder";
import { sql, transaction } from "./client";

export { SYMBOL_PATTERN } from "@/lib/symbol";

/** User-chosen order first (drag & drop), anything not placed yet after it, A-Z. */
export async function listSymbols(): Promise<string[]> {
  const rows = await sql()<{ symbol: string }[]>`select symbol from symbols order by position nulls last, symbol`;
  return rows.map((r) => r.symbol);
}

export async function addSymbol(symbol: string): Promise<boolean> {
  // New symbols go to the end of the user's ordering.
  const rows = await sql()`
    insert into symbols (symbol, position)
    select ${symbol}, coalesce(max(position), -1) + 1 from symbols
    on conflict do nothing returning symbol`;
  return rows.length > 0;
}

export async function removeSymbol(symbol: string): Promise<boolean> {
  const rows = await sql()`delete from symbols where symbol = ${symbol} returning symbol`;
  return rows.length > 0;
}

/** Persist a drag & drop ordering (see mergeOrder for how partial/stale requests are handled). */
export async function setSymbolOrder(requested: string[]): Promise<string[]> {
  return transaction(async (tx) => {
    const current = (await tx<{ symbol: string }[]>`select symbol from symbols order by position nulls last, symbol`).map(
      (r) => r.symbol,
    );
    const final = mergeOrder(current, requested);
    for (const [position, symbol] of final.entries()) {
      await tx`update symbols set position = ${position} where symbol = ${symbol}`;
    }
    return final;
  });
}

/** Changes whenever the stored logo does, so /api/logo/SYM?v=<it> can be cached by the browser for long. null = no logo. */
type LogoVersion = number | null;

export interface SymbolEntry {
  symbol: string;
  logoVersion: LogoVersion;
}

/** Tracked symbols in display order, with whether each has a logo: database only, no third-party calls. */
export async function listSymbolEntries(): Promise<SymbolEntry[]> {
  return sql()<SymbolEntry[]>`
    select symbol,
           case when logo_type is not null then (extract(epoch from logo_checked_at) * 1000)::float8 end as "logoVersion"
    from symbols order by position nulls last, symbol`;
}

export interface TrackedSymbol {
  symbol: string;
  logoVersion: LogoVersion;
  price: number | null;
  quoteTime: Date | null;
  asOf: string | null;
  refClose: number | null;
  levels: { tier: Tier; price: number; method: string; zoneLow: number | null; touches: number | null }[];
}

/** Everything the dashboard needs, from cache only (no external API calls). */
export async function listTrackedSymbols(): Promise<TrackedSymbol[]> {
  const db = sql();
  const [symbols, levels, quotes] = await Promise.all([
    db<{ symbol: string; logoVersion: LogoVersion }[]>`
      select symbol,
             case when logo_type is not null then (extract(epoch from logo_checked_at) * 1000)::float8 end as "logoVersion"
      from symbols order by position nulls last, symbol`,
    db<{ symbol: string; tier: Tier; price: number; method: string; zoneLow: number | null; touches: number | null; ref_close: number; as_of: string }[]>`
      select symbol, tier, price::float8 as price, method, zone_low::float8 as "zoneLow", touches,
             ref_close::float8 as ref_close, as_of::text as as_of
      from support_levels`,
    db<{ symbol: string; price: number; quote_time: Date }[]>`
      select symbol, price::float8 as price, quote_time from quotes`,
  ]);

  const order: Record<Tier, number> = { minor: 0, intermediate: 1, major: 2 };
  return symbols.map(({ symbol, logoVersion }) => {
    const mine = levels.filter((l) => l.symbol === symbol).sort((a, b) => order[a.tier] - order[b.tier]);
    const quote = quotes.find((q) => q.symbol === symbol);
    return {
      symbol,
      logoVersion,
      price: quote?.price ?? null,
      quoteTime: quote?.quote_time ?? null,
      asOf: mine[0]?.as_of ?? null,
      refClose: mine[0]?.ref_close ?? null,
      levels: mine.map(({ tier, price, method, zoneLow, touches }) => ({ tier, price, method, zoneLow, touches })),
    };
  });
}
