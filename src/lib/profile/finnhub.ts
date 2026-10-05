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

async function get(path: string, key: string, deadline?: AbortSignal): Promise<Json> {
  const signal = deadline ? AbortSignal.any([AbortSignal.timeout(TIMEOUT_MS), deadline]) : AbortSignal.timeout(TIMEOUT_MS);
  const res = await fetch(`https://finnhub.io/api/v1${path}`, { headers: { "X-Finnhub-Token": key }, cache: "no-store", signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as Json;
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
