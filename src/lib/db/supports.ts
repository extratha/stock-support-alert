import type { Method, Tier, TieredSupport } from "@/lib/support/types";
import { sql } from "./client";

export interface StoredSupport {
  symbol: string;
  tier: Tier;
  method: Method;
  price: number;
  asOf: string;
}

/** Atomically swap in a fresh set of levels for one symbol. */
export async function replaceSupports(symbol: string, asOf: string, refClose: number, tiers: TieredSupport[]) {
  await sql().begin(async (tx) => {
    await tx`delete from support_levels where symbol = ${symbol}`;
    for (const t of tiers) {
      await tx`
        insert into support_levels (symbol, tier, price, method, ref_close, as_of)
        values (${symbol}, ${t.tier}, ${t.price}, ${t.method}, ${refClose}, ${asOf})`;
    }
  });
}

export async function listSupports(): Promise<StoredSupport[]> {
  return sql()<StoredSupport[]>`
    select symbol, tier, method, price::float8 as price, as_of::text as "asOf" from support_levels`;
}

/** symbol -> as_of date of its cached levels, used to skip already-fresh symbols. */
export async function supportAsOfBySymbol(): Promise<Record<string, string>> {
  const rows = await sql()<{ symbol: string; as_of: string }[]>`
    select symbol, max(as_of)::text as as_of from support_levels group by symbol`;
  return Object.fromEntries(rows.map((r) => [r.symbol, r.as_of]));
}
