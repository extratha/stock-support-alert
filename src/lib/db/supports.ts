import type { LevelTest } from "@/lib/support/track";
import type { Method, Tier, TieredSupport } from "@/lib/support/types";
import { sql, transaction } from "./client";

export interface StoredSupport {
  symbol: string;
  tier: Tier;
  method: Method;
  price: number;
  zoneLow: number | null;
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
        insert into support_levels (symbol, tier, price, method, zone_low, touches, ref_close, as_of)
        values (${symbol}, ${t.tier}, ${t.price}, ${t.method}, ${t.zoneLow ?? null}, ${t.touches ?? null}, ${refClose}, ${asOf})
        on conflict (symbol, tier) do update
          set price = excluded.price, method = excluded.method, zone_low = excluded.zone_low, touches = excluded.touches,
              ref_close = excluded.ref_close, as_of = excluded.as_of, computed_at = now()`;
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
    select symbol, tier, method, price::float8 as price, zone_low::float8 as "zoneLow", as_of::text as "asOf" from support_levels`;
}

/** symbol -> as_of date of its cached levels, used to skip already-fresh symbols. */
export async function supportAsOfBySymbol(): Promise<Record<string, string>> {
  const rows = await sql()<{ symbol: string; as_of: string }[]>`
    select symbol, max(as_of)::text as as_of from support_levels group by symbol`;
  return Object.fromEntries(rows.map((r) => [r.symbol, r.as_of]));
}

/** Swap in the replayed history of level touches for one symbol. */
export async function replaceSupportTests(symbol: string, tests: LevelTest[]) {
  await transaction(async (tx) => {
    await tx`delete from support_tests where symbol = ${symbol}`;
    const rows = tests.map((t) => ({
      symbol,
      tier: t.tier,
      method: t.method,
      level: t.level,
      zone_low: t.zoneLow,
      touches: t.touches,
      touched_on: t.touchedOn,
      outcome: t.outcome,
      resolved_on: t.resolvedOn,
      expected_held: t.expectedHeld,
    }));
    // chunked: one statement per few hundred rows keeps the parameter count well under Postgres' limit
    for (let i = 0; i < rows.length; i += 500) await tx`insert into support_tests ${tx(rows.slice(i, i + 500))}`;
  });
}

export interface StoredTest extends LevelTest {
  symbol: string;
}

export async function listSupportTests(): Promise<StoredTest[]> {
  return sql()<StoredTest[]>`
    select symbol, tier, method, level::float8 as level, zone_low::float8 as "zoneLow", touches,
           touched_on::text as "touchedOn", outcome, resolved_on::text as "resolvedOn",
           expected_held as "expectedHeld"
    from support_tests order by symbol, touched_on`;
}
