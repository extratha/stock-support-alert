import { formatAlertMessage, type AlertItem } from "@/lib/alerts/format";
import { evaluateTier } from "@/lib/alerts/evaluate";
import { claimAlert, loadStates, recordAlerts, rearm, releaseAlert, stateKey } from "@/lib/db/alerts";
import { listSupports } from "@/lib/db/supports";
import { listSymbols } from "@/lib/db/symbols";
import { isMarketOpen, MARKET_TZ } from "@/lib/market/calendar";
import { getQuotes } from "./quotes";
import { notify, recipients } from "./notify";

export interface CheckSummary {
  skipped?: "market_closed" | "no_symbols";
  checked: number;
  quotesFetched: number;
  quotesCached: number;
  alerts: string[];
  rearmed: string[];
  errors: Record<string, string>;
  /** Alerts held back because nobody is subscribed yet. */
  noRecipients?: boolean;
}

const timeLabel = (now: Date) =>
  new Intl.DateTimeFormat("th-TH", {
    timeZone: MARKET_TZ,
    dateStyle: "medium",
    timeStyle: "short",
  }).format(now) + " (เวลานิวยอร์ก)";

/** One tick: quote every tracked symbol, compare with cached levels, push LINE alerts. */
export async function checkAlerts(now: Date, opts: { force?: boolean } = {}): Promise<CheckSummary> {
  const summary: CheckSummary = { checked: 0, quotesFetched: 0, quotesCached: 0, alerts: [], rearmed: [], errors: {} };

  if (!opts.force && !isMarketOpen(now)) return { ...summary, skipped: "market_closed" };

  const symbols = await listSymbols();
  if (symbols.length === 0) return { ...summary, skipped: "no_symbols" };

  const [supports, states, quotes] = await Promise.all([listSupports(), loadStates(), getQuotes(symbols, now)]);
  summary.quotesFetched = quotes.fetched;
  summary.quotesCached = quotes.cached;
  summary.errors = quotes.errors;
  summary.checked = Object.keys(quotes.prices).length;

  const pending: { item: AlertItem; previousAlertAt: Date | null }[] = [];

  for (const s of supports) {
    const price = quotes.prices[s.symbol];
    if (price === undefined) continue;
    const state = states.get(stateKey(s.symbol, s.tier));

    const decision = evaluateTier({ price, level: s.price, state, now });
    if (decision === "rearm") {
      await rearm(s.symbol, s.tier);
      summary.rearmed.push(`${s.symbol}:${s.tier}`);
    } else if (decision === "alert") {
      if (await claimAlert(s.symbol, s.tier)) {
        pending.push({
          item: { symbol: s.symbol, tier: s.tier, method: s.method, price, level: s.price },
          previousAlertAt: state?.lastAlertAt ?? null,
        });
      }
    }
  }
  if (pending.length === 0) return summary;

  // Don't burn alerts (and re-arm state) while nobody can receive them.
  if ((await recipients()).length === 0) {
    for (const p of pending) await releaseAlert(p.item.symbol, p.item.tier, p.previousAlertAt);
    return { ...summary, noRecipients: true };
  }

  try {
    await notify(formatAlertMessage(pending.map((p) => p.item), timeLabel(now)));
  } catch (err) {
    for (const p of pending) await releaseAlert(p.item.symbol, p.item.tier, p.previousAlertAt);
    throw err;
  }

  await recordAlerts(pending.map((p) => p.item));
  summary.alerts = pending.map((p) => `${p.item.symbol}:${p.item.tier}`);
  return summary;
}
