import type { Method, Tier, TieredSupport } from "@/lib/support/types";
import { sql, transaction } from "./client";

export interface StoredSupport {
  symbol: string;
  tier: Tier;
  method: Method;
  price: number;
  asOf: string;
}

/**
 * Atomically swap in a fresh set of levels for one symbol.
 *
 * Upsert + "delete the tiers that are gone" instead of "delete everything, insert everything": two
 * runs for the same symbol at the same time (cron recalculation overlapping with adding that symbol)
 * used to collide on the primary key. Now the second one simply waits for the first and overwrites it.
 */
export async function replaceSupports(symbol: string, asOf: string, refClose: number, tiers: TieredSupport[]) {
  await transaction(async (tx) => {
    for (const t of tiers) {
      await tx`
        insert into support_levels (symbol, tier, price, method, ref_close, as_of)
        values (${symbol}, ${t.tier}, ${t.price}, ${t.method}, ${refClose}, ${asOf})
        on conflict (symbol, tier) do update
          set price = excluded.price, method = excluded.method, ref_close = excluded.ref_close,
              as_of = excluded.as_of, computed_at = now()`;
    }
    if (tiers.length === 0) {
      await tx`delete from support_levels where symbol = ${symbol}`;
    } else {
      await tx`delete from support_levels where symbol = ${symbol} and tier not in ${tx(tiers.map((t) => t.tier))}`;
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
