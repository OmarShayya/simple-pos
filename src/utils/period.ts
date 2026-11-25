/**
 * Calendar periods (day / week / month / year) resolved in the lounge's timezone.
 * All ranges are half-open: [start, end).
 */
import { addDays, isDateString, weekdayOf, zonedDateTimeToUtc } from "./time";

export const REPORT_PERIODS = ["day", "week", "month", "year"] as const;
export type ReportPeriod = (typeof REPORT_PERIODS)[number];

export interface TimeRange {
  start: Date;
  end: Date;
}

export interface LabeledRange extends TimeRange {
  label: string;
}

export interface PeriodBucket extends TimeRange {
  key: string;
  label: string;
}

export interface ResolvedPeriod {
  period: ReportPeriod;
  timezone: string;
  range: LabeledRange & { firstDay: string; lastDay: string };
  /**
   * The period before. While the selected period is still running, it is cut at the same
   * elapsed time ("to-date" comparison) so partial numbers aren't compared with a full period.
   */
  previous: LabeledRange & { firstDay: string; lastDay: string };
  comparison: "full" | "to-date";
  buckets: PeriodBucket[];
}

const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_LONG = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const WEEKDAYS_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const parts = (date: string) => {
  const [y, m, d] = date.split("-").map(Number);
  return { y, m, d };
};
const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;

const addMonths = (date: string, months: number): string => {
  const { y, m } = parts(date);
  const index = y * 12 + (m - 1) + months;
  return ymd(Math.floor(index / 12), (index % 12) + 1, 1);
};

/** Local calendar days [first, next) covered by the period containing `date`. */
const calendarSpan = (period: ReportPeriod, date: string): { first: string; next: string } => {
  const { y, m } = parts(date);
  switch (period) {
    case "day":
      return { first: date, next: addDays(date, 1) };
    case "week": {
      const first = addDays(date, -((weekdayOf(date) + 6) % 7)); // weeks start on Monday
      return { first, next: addDays(first, 7) };
    }
    case "month": {
      const first = ymd(y, m, 1);
      return { first, next: addMonths(first, 1) };
    }
    case "year":
      return { first: ymd(y, 1, 1), next: ymd(y + 1, 1, 1) };
  }
};

const dayLabel = (date: string) => {
  const { y, m, d } = parts(date);
  return `${WEEKDAYS_SHORT[weekdayOf(date)]} ${d} ${MONTHS_SHORT[m - 1]} ${y}`;
};

const spanLabel = (period: ReportPeriod, first: string, last: string): string => {
  const a = parts(first);
  const b = parts(last);
  switch (period) {
    case "day":
      return dayLabel(first);
    case "week":
      if (a.y !== b.y) return `${a.d} ${MONTHS_SHORT[a.m - 1]} ${a.y} – ${b.d} ${MONTHS_SHORT[b.m - 1]} ${b.y}`;
      if (a.m !== b.m) return `${a.d} ${MONTHS_SHORT[a.m - 1]} – ${b.d} ${MONTHS_SHORT[b.m - 1]} ${b.y}`;
      return `${a.d}–${b.d} ${MONTHS_SHORT[b.m - 1]} ${b.y}`;
    case "month":
      return `${MONTHS_LONG[a.m - 1]} ${a.y}`;
    case "year":
      return String(a.y);
  }
};

const buildBuckets = (period: ReportPeriod, first: string, next: string, tz: string): PeriodBucket[] => {
  const buckets: PeriodBucket[] = [];
  if (period === "day") {
    for (let h = 0; h < 24; h++) {
      buckets.push({
        key: pad(h),
        label: `${pad(h)}:00`,
        start: zonedDateTimeToUtc(first, h * 60, tz),
        end: zonedDateTimeToUtc(first, (h + 1) * 60, tz),
      });
    }
    return buckets;
  }
  if (period === "year") {
    for (let i = 0; i < 12; i++) {
      const monthStart = addMonths(first, i);
      buckets.push({
        key: monthStart.slice(0, 7),
        label: MONTHS_SHORT[i],
        start: zonedDateTimeToUtc(monthStart, 0, tz),
        end: zonedDateTimeToUtc(addMonths(first, i + 1), 0, tz),
      });
    }
    return buckets;
  }
  for (let day = first; day < next; day = addDays(day, 1)) {
    const { d } = parts(day);
    buckets.push({
      key: day,
      label: period === "week" ? `${WEEKDAYS_SHORT[weekdayOf(day)]} ${d}` : String(d),
      start: zonedDateTimeToUtc(day, 0, tz),
      end: zonedDateTimeToUtc(addDays(day, 1), 0, tz),
    });
  }
  return buckets;
};

const toRange = (period: ReportPeriod, first: string, next: string, tz: string) => {
  const lastDay = addDays(next, -1);
  return {
    start: zonedDateTimeToUtc(first, 0, tz),
    end: zonedDateTimeToUtc(next, 0, tz),
    label: spanLabel(period, first, lastDay),
    firstDay: first,
    lastDay,
  };
};

export const isReportPeriod = (value: unknown): value is ReportPeriod =>
  typeof value === "string" && (REPORT_PERIODS as readonly string[]).includes(value);

export const resolvePeriod = (period: ReportPeriod, date: string, tz: string, now: Date = new Date()): ResolvedPeriod => {
  if (!isReportPeriod(period)) throw new Error(`Unknown period "${period}"`);
  if (!isDateString(date)) throw new Error(`Invalid date "${date}"`);

  const span = calendarSpan(period, date);
  const range = toRange(period, span.first, span.next, tz);
  const prevSpan = calendarSpan(period, addDays(span.first, -1));
  const previous = toRange(period, prevSpan.first, prevSpan.next, tz);

  let comparison: ResolvedPeriod["comparison"] = "full";
  if (now >= range.start && now < range.end) {
    comparison = "to-date";
    const elapsed = now.getTime() - range.start.getTime();
    previous.end = new Date(Math.min(previous.end.getTime(), previous.start.getTime() + elapsed));
  }

  return {
    period,
    timezone: tz,
    range,
    previous,
    comparison,
    buckets: buildBuckets(period, span.first, span.next, tz),
  };
};

/** Index of the bucket containing `instant` (buckets are contiguous and sorted), or -1. */
export const locateBucket = (buckets: readonly TimeRange[], instant: Date): number => {
  const t = instant.getTime();
  let lo = 0;
  let hi = buckets.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (t < buckets[mid].start.getTime()) hi = mid - 1;
    else if (t >= buckets[mid].end.getTime()) lo = mid + 1;
    else return mid;
  }
  return -1;
};

/** Local YYYY-MM-DD bounds → instants. `to` is inclusive (the whole day). */
export const localDateRange = (tz: string, from?: string, to?: string): Partial<TimeRange> => ({
  start: from ? zonedDateTimeToUtc(from, 0, tz) : undefined,
  end: to ? zonedDateTimeToUtc(addDays(to, 1), 0, tz) : undefined,
});

/** Overlap in milliseconds between [a.start, a.end) and [b.start, b.end). */
export const overlapMs = (a: TimeRange, b: TimeRange): number =>
  Math.max(0, Math.min(a.end.getTime(), b.end.getTime()) - Math.max(a.start.getTime(), b.start.getTime()));
