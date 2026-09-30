/**
 * The one place that decides how dates look everywhere (web, LINE replies, alerts):
 *   date       DD/MM/YYYY            (Gregorian / ค.ศ., never the Buddhist-era year)
 *   date+time  DD/MM/YYYY HH:mm:ss   (24-hour)
 * Built from Intl parts rather than a locale's "short" style, so server, browser and
 * Node versions can never disagree (and the Thai locale's พ.ศ. can't sneak in).
 */
const DISPLAY_TZ = "Asia/Bangkok";

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatterFor(timeZone: string) {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-GB", {
      timeZone,
      calendar: "gregory",
      numberingSystem: "latn",
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatters.set(timeZone, f);
  }
  return f;
}

/** "DD/MM/YYYY HH:mm:ss" for an instant, in `timeZone` (default: Thailand). */
export function formatDateTime(instant: Date, timeZone: string = DISPLAY_TZ): string {
  const p: Record<string, string> = {};
  for (const part of formatterFor(timeZone).formatToParts(instant)) p[part.type] = part.value;
  return `${p.day}/${p.month}/${p.year} ${p.hour}:${p.minute}:${p.second}`;
}

/** "YYYY-MM-DD" (a calendar date, no time zone involved) -> "DD/MM/YYYY". Other input is returned unchanged. */
export function formatDateString(isoDate: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : isoDate;
}
