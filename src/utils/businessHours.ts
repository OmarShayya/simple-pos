import { IDaySchedule, DEFAULT_SCHEDULE } from "../models/reservationSettings.model";
import { TimeRange } from "./period";
import { addDays, timeToMinutes, weekdayOf, zonedDateTimeToUtc } from "./time";

export interface BusinessWindow extends TimeRange {
  date: string;
  closed: boolean;
  open: string;
  close: string;
}

/** Opening window of a business day (a night past midnight belongs to the day it started). */
export const businessWindow = (schedule: IDaySchedule[], tz: string, date: string): BusinessWindow => {
  const day = schedule.find((d) => d.day === weekdayOf(date)) ?? DEFAULT_SCHEDULE[weekdayOf(date)];
  const openMin = timeToMinutes(day.open);
  let closeMin = timeToMinutes(day.close);
  if (closeMin <= openMin) closeMin += 24 * 60;
  return {
    date,
    closed: day.closed,
    open: day.open,
    close: day.close,
    start: zonedDateTimeToUtc(date, openMin, tz),
    end: zonedDateTimeToUtc(date, closeMin, tz),
  };
};

/**
 * Open intervals clipped to a range covering local days `firstDay`…`lastDay`
 * (the night of the day before is included, since it can run past midnight into the range).
 */
export const openWindowsInRange = (
  schedule: IDaySchedule[],
  tz: string,
  range: TimeRange & { firstDay: string; lastDay: string }
): TimeRange[] => {
  const windows: TimeRange[] = [];
  for (let date = addDays(range.firstDay, -1); date <= range.lastDay; date = addDays(date, 1)) {
    const w = businessWindow(schedule, tz, date);
    if (w.closed) continue;
    const start = new Date(Math.max(w.start.getTime(), range.start.getTime()));
    const end = new Date(Math.min(w.end.getTime(), range.end.getTime()));
    if (end > start) windows.push({ start, end });
  }
  return windows;
};
