import type { TierState } from "@/lib/alerts/evaluate";
import type { Method, Tier } from "@/lib/support/types";
import { sql } from "./client";

export const stateKey = (symbol: string, tier: Tier | string) => `${symbol}:${tier}`;

export async function loadStates(): Promise<Map<string, TierState>> {
  const rows = await sql()<{ symbol: string; tier: string; armed: boolean; last_alert_at: Date | null }[]>`
    select symbol, tier, armed, last_alert_at from alert_state`;
  return new Map(rows.map((r) => [stateKey(r.symbol, r.tier), { armed: r.armed, lastAlertAt: r.last_alert_at }]));
}

export async function rearm(symbol: string, tier: Tier) {
  await sql()`update alert_state set armed = true where symbol = ${symbol} and tier = ${tier}`;
}

/**
 * Atomically flip (symbol, tier) armed -> disarmed. Only one of several
 * overlapping job runs can win, which prevents duplicate pushes.
 */
export async function claimAlert(symbol: string, tier: Tier): Promise<boolean> {
  const rows = await sql()`
    insert into alert_state (symbol, tier, armed, last_alert_at)
    values (${symbol}, ${tier}, false, now())
    on conflict (symbol, tier) do update set armed = false, last_alert_at = now()
      where alert_state.armed = true
    returning symbol`;
  return rows.length > 0;
}

/** Undo a claim when the push failed, so the next run retries. */
export async function releaseAlert(symbol: string, tier: Tier, previousAlertAt: Date | null) {
  await sql()`
    update alert_state set armed = true, last_alert_at = ${previousAlertAt}
    where symbol = ${symbol} and tier = ${tier}`;
}

export interface AlertRecord {
  symbol: string;
  tier: Tier;
  method: Method;
  price: number;
  level: number;
}

export async function recordAlerts(records: AlertRecord[]) {
  for (const r of records) {
    await sql()`
      insert into alert_history (symbol, tier, method, price, level)
      values (${r.symbol}, ${r.tier}, ${r.method}, ${r.price}, ${r.level})`;
  }
}

export interface HistoryRow extends AlertRecord {
  id: number;
  sentAt: Date;
}

export async function listHistory(limit = 200): Promise<HistoryRow[]> {
  return sql()<HistoryRow[]>`
    select id::int as id, symbol, tier, method, price::float8 as price, level::float8 as level, sent_at as "sentAt"
    from alert_history order by sent_at desc limit ${limit}`;
}
