/**
 * NYSE trading calendar in America/New_York. All wall-clock logic goes through
 * Intl so DST (EST <-> EDT) is handled by the tz database, never by hand-rolled
 * UTC offsets.
 */
export const MARKET_TZ = "America/New_York";

const OPEN_MIN = 9 * 60 + 30;
const CLOSE_MIN = 16 * 60;
const EARLY_CLOSE_MIN = 13 * 60;
/** Daily bars are considered final this long after the close. */
const SETTLE_MIN = 15;

const formatter = new Intl.DateTimeFormat("en-US", {
  timeZone: MARKET_TZ,
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

export interface NyTime {
  /** YYYY-MM-DD in New York. */
  date: string;
  /** Minutes since local midnight. */
  minutes: number;
}

export function nyTime(instant: Date): NyTime {
  const p: Record<string, string> = {};
  for (const part of formatter.formatToParts(instant)) p[part.type] = part.value;
  return {
    date: `${p.year}-${p.month}-${p.day}`,
    minutes: Number(p.hour) * 60 + Number(p.minute),
  };
}

// ---- date-string helpers (pure calendar arithmetic, done in UTC) ----

const toUtc = (date: string) => {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
};
const fromUtc = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (date: string, n: number) => {
  const d = toUtc(date);
  d.setUTCDate(d.getUTCDate() + n);
  return fromUtc(d);
};
const weekday = (date: string) => toUtc(date).getUTCDay(); // 0 = Sunday
const ymd = (y: number, m: number, d: number) => fromUtc(new Date(Date.UTC(y, m - 1, d)));

/** n-th (1-based) given weekday of a month. */
function nthWeekday(y: number, month: number, dow: number, n: number): string {
  const first = weekday(ymd(y, month, 1));
  return ymd(y, month, 1 + ((dow - first + 7) % 7) + (n - 1) * 7);
}
function lastWeekday(y: number, month: number, dow: number): string {
  const last = ymd(y, month + 1, 0 + 1); // first of next month
  const back = (weekday(addDays(last, -1)) - dow + 7) % 7;
  return addDays(last, -1 - back);
}
/** Weekend holidays: Saturday -> Friday, Sunday -> Monday. */
function observed(date: string): string {
  const dow = weekday(date);
  if (dow === 6) return addDays(date, -1);
  if (dow === 0) return addDays(date, 1);
  return date;
}
/** Western Easter Sunday (anonymous Gregorian algorithm). */
function easter(y: number): string {
  const a = y % 19;
  const b = Math.floor(y / 100);
  const c = y % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return ymd(y, month, day);
}

const holidayCache = new Map<number, Set<string>>();

/** Full-day NYSE closures whose observed date falls in year `y`. */
function holidays(y: number): Set<string> {
  const cached = holidayCache.get(y);
  if (cached) return cached;

  const set = new Set<string>();
  // New Year's Day: Sunday -> Monday, but Saturday is NOT observed on the prior Friday.
  const newYear = ymd(y, 1, 1);
  if (weekday(newYear) !== 6) set.add(observed(newYear));
  set.add(nthWeekday(y, 1, 1, 3)); // Martin Luther King Jr. Day
  set.add(nthWeekday(y, 2, 1, 3)); // Presidents' Day
  set.add(addDays(easter(y), -2)); // Good Friday
  set.add(lastWeekday(y, 5, 1)); // Memorial Day
  if (y >= 2022) set.add(observed(ymd(y, 6, 19))); // Juneteenth
  set.add(observed(ymd(y, 7, 4))); // Independence Day
  set.add(nthWeekday(y, 9, 1, 1)); // Labor Day
  set.add(nthWeekday(y, 11, 4, 4)); // Thanksgiving
  set.add(observed(ymd(y, 12, 25))); // Christmas

  holidayCache.set(y, set);
  return set;
}

export function isTradingDay(date: string): boolean {
  const dow = weekday(date);
  if (dow === 0 || dow === 6) return false;
  return !holidays(Number(date.slice(0, 4))).has(date);
}

/** Minutes after local midnight when the regular session ends (13:00 on early-close days). */
export function sessionCloseMinutes(date: string): number {
  const y = Number(date.slice(0, 4));
  const dayAfterThanksgiving = addDays(nthWeekday(y, 11, 4, 4), 1);
  const isEarly =
    date === dayAfterThanksgiving || date === ymd(y, 7, 3) || date === ymd(y, 12, 24);
  return isEarly ? EARLY_CLOSE_MIN : CLOSE_MIN;
}

export function isMarketOpen(now: Date = new Date()): boolean {
  const { date, minutes } = nyTime(now);
  if (!isTradingDay(date)) return false;
  return minutes >= OPEN_MIN && minutes < sessionCloseMinutes(date);
}

/** Most recent trading date whose daily bar is final as of `now`. */
export function lastCompletedSession(now: Date = new Date()): string {
  const { date, minutes } = nyTime(now);
  let cursor = date;
  if (!(isTradingDay(cursor) && minutes >= sessionCloseMinutes(cursor) + SETTLE_MIN)) {
    cursor = addDays(cursor, -1);
  }
  while (!isTradingDay(cursor)) cursor = addDays(cursor, -1);
  return cursor;
}
