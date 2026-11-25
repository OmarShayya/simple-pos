import { Money, roundMoney } from "../../utils/money";

/**
 * The single place that turns station time into money.
 * Every started minute is billed (the rule the lounge has always used).
 */
export const billableMinutes = (start: Date, end: Date): number =>
  Math.max(0, Math.ceil((end.getTime() - start.getTime()) / 60_000));

export const costForMinutes = (hourlyRate: Money, minutes: number): Money =>
  roundMoney({ usd: (hourlyRate.usd * minutes) / 60, lbp: (hourlyRate.lbp * minutes) / 60 });

export interface SessionTiming {
  startTime: Date;
  endTime?: Date | null;
  hourlyRate: Money;
}

/** Minutes + cost of a session, up to `now` while it is still running. */
export const sessionCharge = (session: SessionTiming, now: Date = new Date()) => {
  const minutes = billableMinutes(session.startTime, session.endTime ?? now);
  return { minutes, cost: costForMinutes(session.hourlyRate, minutes) };
};

/** 90 → "1h 30m", 120 → "2h", 45 → "45m" */
export const formatDuration = (minutes: number): string => {
  const m = Math.max(0, Math.round(minutes));
  const h = Math.floor(m / 60);
  const rest = m % 60;
  if (!h) return `${rest}m`;
  return rest ? `${h}h ${rest}m` : `${h}h`;
};

/** Invoice line label for station time: "PC-05 · 1h 30m", "PS-1 · 2h". */
export const gamingLineName = (pcNumber: string, minutes: number): string =>
  `${pcNumber} · ${formatDuration(minutes)}`;
