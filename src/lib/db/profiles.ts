import type { Fundamentals } from "@/lib/profile/finnhub";
import type { HistoryStats } from "@/lib/profile/history";
import { sql } from "./client";

export interface StockProfile extends Partial<HistoryStats>, Partial<Fundamentals> {
  symbol: string;
  historyAt: Date | null;
  fundamentalsAt: Date | null;
}

export async function saveHistoryStats(symbol: string, h: HistoryStats) {
  await sql()`
    insert into stock_profiles (symbol, last_close, high_52w, max_drawdown, drawdown_peak_date, drawdown_trough_date,
                                drawdown_recovered, history_from, history_at)
    values (${symbol}, ${h.lastClose}, ${h.high52w}, ${h.maxDrawdown}, ${h.peakDate}, ${h.troughDate}, ${h.recovered},
            ${h.historyFrom}, now())
    on conflict (symbol) do update set
      last_close = excluded.last_close, high_52w = excluded.high_52w, max_drawdown = excluded.max_drawdown,
      drawdown_peak_date = excluded.drawdown_peak_date, drawdown_trough_date = excluded.drawdown_trough_date,
      drawdown_recovered = excluded.drawdown_recovered, history_from = excluded.history_from, history_at = now()`;
}

export async function saveFundamentals(symbol: string, f: Fundamentals) {
  await sql()`
    insert into stock_profiles (symbol, pe, forward_pe, revenue_growth, net_margin, beta, next_earnings, earnings_hour, fundamentals_at)
    values (${symbol}, ${f.pe}, ${f.forwardPe}, ${f.revenueGrowth}, ${f.netMargin}, ${f.beta}, ${f.nextEarnings}, ${f.earningsHour}, now())
    on conflict (symbol) do update set
      pe = excluded.pe, forward_pe = excluded.forward_pe, revenue_growth = excluded.revenue_growth,
      net_margin = excluded.net_margin, beta = excluded.beta, next_earnings = excluded.next_earnings,
      earnings_hour = excluded.earnings_hour, fundamentals_at = now()`;
}

/** Symbols whose fundamentals are missing or older than `maxAgeHours`. */
export async function symbolsNeedingFundamentals(maxAgeHours: number, limit: number): Promise<string[]> {
  const rows = await sql()<{ symbol: string }[]>`
    select s.symbol from symbols s left join stock_profiles p using (symbol)
    where p.fundamentals_at is null or p.fundamentals_at < now() - make_interval(hours => ${maxAgeHours})
    order by p.fundamentals_at nulls first, s.symbol
    limit ${limit}`;
  return rows.map((r) => r.symbol);
}

export async function listProfiles(): Promise<StockProfile[]> {
  return sql()<StockProfile[]>`
    select symbol,
           last_close::float8 as "lastClose", high_52w::float8 as "high52w", max_drawdown as "maxDrawdown",
           drawdown_peak_date::text as "peakDate", drawdown_trough_date::text as "troughDate",
           drawdown_recovered as recovered, history_from::text as "historyFrom", history_at as "historyAt",
           pe, forward_pe as "forwardPe", revenue_growth as "revenueGrowth", net_margin as "netMargin", beta,
           next_earnings::text as "nextEarnings", earnings_hour as "earningsHour", fundamentals_at as "fundamentalsAt"
    from stock_profiles`;
}
