/**
 * Small timezone helpers (no extra dependencies) so reservation times are always
 * interpreted in the lounge's local time, whatever timezone the server runs in.
 */

const dtfCache = new Map<string, Intl.DateTimeFormat>();

const getParts = (tz: string, date: Date) => {
  let dtf = dtfCache.get(tz);
  if (!dtf) {
    dtf = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      weekday: "short",
    });
    dtfCache.set(tz, dtf);
  }
  const parts: Record<string, string> = {};
  for (const p of dtf.formatToParts(date)) parts[p.type] = p.value;
  return parts;
};

/** Offset (ms) between local wall-clock time in `tz` and UTC at the given instant. */
export const getTzOffsetMs = (tz: string, date: Date): number => {
  const p = getParts(tz, date);
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second);
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
};

/** Validates a YYYY-MM-DD string. */
export const isDateString = (s: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(`${s}T00:00:00Z`));

/** Validates an HH:mm (24h) string. */
export const isTimeString = (s: string): boolean => /^([01]\d|2[0-3]):[0-5]\d$/.test(s);

/** "16:30" → 990 */
export const timeToMinutes = (hhmm: string): number => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};

/**
 * The UTC instant for a local wall-clock time on a given local date.
 * `minutes` may exceed 1440 to mean "after midnight, next day".
 */
export const zonedDateTimeToUtc = (date: string, minutes: number, tz: string): Date => {
  const [y, m, d] = date.split("-").map(Number);
  const guess = Date.UTC(y, m - 1, d) + minutes * 60_000;
  const off1 = getTzOffsetMs(tz, new Date(guess));
  let ts = guess - off1;
  const off2 = getTzOffsetMs(tz, new Date(ts));
  if (off2 !== off1) ts = guess - off2; // DST edge
  return new Date(ts);
};

/** Local calendar date (YYYY-MM-DD) of an instant in `tz`. */
export const localDateString = (date: Date, tz: string): string => {
  const p = getParts(tz, date);
  return `${p.year}-${p.month}-${p.day}`;
};

/** Local weekday (0 = Sunday … 6 = Saturday) of a YYYY-MM-DD date. */
export const weekdayOf = (date: string): number => new Date(`${date}T12:00:00Z`).getUTCDay();

/** Adds days to a YYYY-MM-DD string. */
export const addDays = (date: string, days: number): string => {
  const t = new Date(`${date}T12:00:00Z`);
  t.setUTCDate(t.getUTCDate() + days);
  return t.toISOString().slice(0, 10);
};

/** "8:30 PM" in the given timezone. */
export const formatTime = (date: Date, tz: string): string =>
  new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" }).format(date);

/** "Tue, Nov 25" in the given timezone. */
export const formatDay = (date: Date, tz: string): string =>
  new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", month: "short", day: "numeric" }).format(date);

/** Local hour (0–23) of an instant in `tz`. */
export const localHour = (date: Date, tz: string): number => +getParts(tz, date).hour % 24;

/** Start (inclusive) and end (exclusive) instants of a local calendar day. */
export const localDayBounds = (date: string, tz: string): { start: Date; end: Date } => ({
  start: zonedDateTimeToUtc(date, 0, tz),
  end: zonedDateTimeToUtc(addDays(date, 1), 0, tz),
});
