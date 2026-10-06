import type { AnalystView, Fundamentals } from "@/lib/profile/finnhub";
import type { HistoryStats } from "@/lib/profile/history";
import { sql } from "./client";

export interface StockProfile extends Partial<HistoryStats>, Partial<Fundamentals>, Partial<AnalystView> {
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
    insert into stock_profiles (symbol, pe, forward_pe, revenue_growth, net_margin, beta, dividend_yield, next_earnings, earnings_hour, fundamentals_at)
    values (${symbol}, ${f.pe}, ${f.forwardPe}, ${f.revenueGrowth}, ${f.netMargin}, ${f.beta}, ${f.dividendYield}, ${f.nextEarnings}, ${f.earningsHour}, now())
    on conflict (symbol) do update set
      pe = excluded.pe, forward_pe = excluded.forward_pe, revenue_growth = excluded.revenue_growth,
      net_margin = excluded.net_margin, beta = excluded.beta, dividend_yield = excluded.dividend_yield, next_earnings = excluded.next_earnings,
      earnings_hour = excluded.earnings_hour, fundamentals_at = now()`;
}

export async function saveAnalysts(symbol: string, a: AnalystView) {
  await sql()`
    insert into stock_profiles (symbol, rec_strong_buy, rec_buy, rec_hold, rec_sell, rec_strong_sell, rec_period,
                                target_mean, target_high, target_low, target_updated, analysts_at)
    values (${symbol}, ${a.recStrongBuy}, ${a.recBuy}, ${a.recHold}, ${a.recSell}, ${a.recStrongSell}, ${a.recPeriod},
            ${a.targetMean}, ${a.targetHigh}, ${a.targetLow}, ${a.targetUpdated}, now())
    on conflict (symbol) do update set
      rec_strong_buy = excluded.rec_strong_buy, rec_buy = excluded.rec_buy, rec_hold = excluded.rec_hold,
      rec_sell = excluded.rec_sell, rec_strong_sell = excluded.rec_strong_sell, rec_period = excluded.rec_period,
      target_mean = excluded.target_mean, target_high = excluded.target_high, target_low = excluded.target_low,
      target_updated = excluded.target_updated, analysts_at = now()`;
}

/** Of `symbols`, those whose analyst figures are missing or older than `maxAgeHours`. */
export async function symbolsNeedingAnalysts(symbols: string[], maxAgeHours: number): Promise<Set<string>> {
  if (symbols.length === 0) return new Set();
  const fresh = await sql()<{ symbol: string }[]>`
    select symbol from stock_profiles
    where symbol in ${sql()(symbols)} and analysts_at >= now() - make_interval(hours => ${maxAgeHours})`;
  const skip = new Set(fresh.map((r) => r.symbol));
  return new Set(symbols.filter((s) => !skip.has(s)));
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
           pe, forward_pe as "forwardPe", revenue_growth as "revenueGrowth", net_margin as "netMargin", beta, dividend_yield as "dividendYield",
           next_earnings::text as "nextEarnings", earnings_hour as "earningsHour", fundamentals_at as "fundamentalsAt",
           rec_strong_buy as "recStrongBuy", rec_buy as "recBuy", rec_hold as "recHold", rec_sell as "recSell",
           rec_strong_sell as "recStrongSell", rec_period::text as "recPeriod", target_mean as "targetMean",
           target_high as "targetHigh", target_low as "targetLow", target_updated::text as "targetUpdated"
    from stock_profiles`;
}
