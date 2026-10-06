/** Fundamentals from Finnhub (free plan): /stock/metric + /calendar/earnings. Display only. */
export interface Fundamentals {
  pe: number | null;
  forwardPe: number | null;
  /** percent, year over year (83.4 = +83.4%) */
  revenueGrowth: number | null;
  /** percent */
  netMargin: number | null;
  beta: number | null;
  /** percent per year (1.6 = 1.6% of the price); null when the company pays none or Finnhub has no figure */
  dividendYield: number | null;
  nextEarnings: string | null; // YYYY-MM-DD
  earningsHour: string | null; // bmo / amc / dmh
}

/**
 * What brokerage analysts say (opinions, not facts). Recommendation counts are on Finnhub's free plan; the price target
 * may need a paid plan, in which case it stays null.
 */
export interface AnalystView {
  /** latest month's counts */
  recStrongBuy: number | null;
  recBuy: number | null;
  recHold: number | null;
  recSell: number | null;
  recStrongSell: number | null;
  recPeriod: string | null; // YYYY-MM-DD (the month)
  targetMean: number | null;
  targetHigh: number | null;
  targetLow: number | null;
  targetUpdated: string | null; // YYYY-MM-DD
}

export const NO_ANALYSTS: AnalystView = {
  recStrongBuy: null, recBuy: null, recHold: null, recSell: null, recStrongSell: null, recPeriod: null,
  targetMean: null, targetHigh: null, targetLow: null, targetUpdated: null,
};

/** The most recent month of /stock/recommendation (a list, newest first in practice; sorted here to be sure). */
export function parseRecommendations(json: unknown): Pick<AnalystView, "recStrongBuy" | "recBuy" | "recHold" | "recSell" | "recStrongSell" | "recPeriod"> {
  const list = (Array.isArray(json) ? json : []) as Json[];
  const latest = list
    .filter((r) => typeof r.period === "string" && /^\d{4}-\d{2}-\d{2}$/.test(r.period))
    .sort((a, b) => String(b.period).localeCompare(String(a.period)))[0];
  if (!latest) return { recStrongBuy: null, recBuy: null, recHold: null, recSell: null, recStrongSell: null, recPeriod: null };
  return {
    recStrongBuy: num(latest.strongBuy),
    recBuy: num(latest.buy),
    recHold: num(latest.hold),
    recSell: num(latest.sell),
    recStrongSell: num(latest.strongSell),
    recPeriod: String(latest.period),
  };
}

export function parsePriceTarget(json: Json): Pick<AnalystView, "targetMean" | "targetHigh" | "targetLow" | "targetUpdated"> {
  const mean = num(json.targetMean);
  const updated = typeof json.lastUpdated === "string" ? json.lastUpdated.slice(0, 10) : null;
  return {
    targetMean: mean !== null && mean > 0 ? mean : null,
    targetHigh: num(json.targetHigh),
    targetLow: num(json.targetLow),
    targetUpdated: updated && /^\d{4}-\d{2}-\d{2}$/.test(updated) ? updated : null,
  };
}

type Json = Record<string, unknown>;
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const TIMEOUT_MS = 5000;

export function parseMetric(
  json: Json,
): Pick<Fundamentals, "pe" | "forwardPe" | "revenueGrowth" | "netMargin" | "beta" | "dividendYield"> {
  const m = (json.metric ?? {}) as Json;
  return {
    pe: num(m.peTTM) ?? num(m.peBasicExclExtraTTM),
    forwardPe: num(m.forwardPE),
    revenueGrowth: num(m.revenueGrowthTTMYoy),
    netMargin: num(m.netProfitMarginTTM),
    beta: num(m.beta),
    dividendYield: num(m.dividendYieldIndicatedAnnual) ?? num(m.currentDividendYieldTTM),
  };
}

/** Earliest earnings date on or after `today` (YYYY-MM-DD). */
export function parseNextEarnings(json: Json, today: string): Pick<Fundamentals, "nextEarnings" | "earningsHour"> {
  const list = Array.isArray(json.earningsCalendar) ? (json.earningsCalendar as Json[]) : [];
  const next = list
    .filter((e) => typeof e.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(e.date) && e.date >= today)
    .sort((a, b) => String(a.date).localeCompare(String(b.date)))[0];
  return { nextEarnings: next ? String(next.date) : null, earningsHour: next && typeof next.hour === "string" && next.hour ? next.hour : null };
}

class HttpError extends Error {
  constructor(readonly status: number) {
    super(`HTTP ${status}`);
  }
}

async function get(path: string, key: string, deadline?: AbortSignal): Promise<Json> {
  const signal = deadline ? AbortSignal.any([AbortSignal.timeout(TIMEOUT_MS), deadline]) : AbortSignal.timeout(TIMEOUT_MS);
  const res = await fetch(`https://finnhub.io/api/v1${path}`, { headers: { "X-Finnhub-Token": key }, cache: "no-store", signal });
  if (!res.ok) throw new HttpError(res.status);
  return (await res.json()) as Json;
}

/**
 * Best effort: a failure leaves the analyst figures empty and never fails the fundamentals. When Finnhub refuses the
 * price target (401/403: not on this plan), `targets.allowed` turns false so the rest of the run does not ask again.
 */
export async function fetchAnalysts(symbol: string, key: string, targets: { allowed: boolean }, deadline?: AbortSignal): Promise<AnalystView> {
  const s = encodeURIComponent(symbol);
  const [recs, target] = await Promise.all([
    get(`/stock/recommendation?symbol=${s}`, key, deadline).then(parseRecommendations).catch(() => null),
    targets.allowed
      ? get(`/stock/price-target?symbol=${s}`, key, deadline)
          .then(parsePriceTarget)
          .catch((err) => {
            if (err instanceof HttpError && (err.status === 401 || err.status === 403)) targets.allowed = false;
            return null;
          })
      : Promise.resolve(null),
  ]);
  return { ...NO_ANALYSTS, ...(recs ?? {}), ...(target ?? {}) };
}

const addDays = (date: string, n: number) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/** Throws when the metric call fails (so the caller keeps the previous values); the earnings date is best effort. */
export async function fetchFundamentals(symbol: string, key: string, today: string, deadline?: AbortSignal): Promise<Fundamentals> {
  const s = encodeURIComponent(symbol);
  const [metric, earnings] = await Promise.all([
    get(`/stock/metric?symbol=${s}&metric=all`, key, deadline),
    get(`/calendar/earnings?symbol=${s}&from=${today}&to=${addDays(today, 150)}`, key, deadline).catch(() => ({})),
  ]);
  return { ...parseMetric(metric), ...parseNextEarnings(earnings as Json, today) };
}
