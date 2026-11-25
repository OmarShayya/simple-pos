import { Types } from "mongoose";
import GamingSession, { SessionStatus } from "../../models/gamingsession.model";
import { overlapMs, TimeRange } from "../../utils/period";

/**
 * Station occupancy from gaming sessions (cancelled sessions excluded, running ones count up to now).
 * Utilization = time occupied during opening hours / opening hours in the range.
 */
export interface UsageSession {
  pc: Types.ObjectId;
  startTime: Date;
  endTime?: Date | null;
  status: SessionStatus;
}

export interface StationUsage {
  /** Sessions that started inside the range */
  sessions: number;
  occupiedMs: number;
  /** Occupied time that falls inside opening hours */
  openOccupiedMs: number;
}

export const loadSessionsOverlapping = (range: TimeRange): Promise<UsageSession[]> =>
  GamingSession.find({
    status: { $ne: SessionStatus.CANCELLED },
    startTime: { $lt: range.end },
    $or: [{ endTime: { $gt: range.start } }, { endTime: null, status: SessionStatus.ACTIVE }],
  })
    .select("pc startTime endTime status")
    .lean<UsageSession[]>();

const intervalOf = (s: UsageSession, now: Date): TimeRange => ({ start: s.startTime, end: s.endTime ?? now });

export const totalMs = (windows: TimeRange[]): number =>
  windows.reduce((t, w) => t + Math.max(0, w.end.getTime() - w.start.getTime()), 0);

export const usageByStation = (
  sessions: UsageSession[],
  range: TimeRange,
  openWindows: TimeRange[],
  now: Date = new Date()
): Map<string, StationUsage> => {
  const map = new Map<string, StationUsage>();
  for (const s of sessions) {
    const id = String(s.pc);
    const usage = map.get(id) ?? { sessions: 0, occupiedMs: 0, openOccupiedMs: 0 };
    const interval = intervalOf(s, now);
    if (s.startTime >= range.start && s.startTime < range.end) usage.sessions += 1;
    usage.occupiedMs += overlapMs(interval, range);
    usage.openOccupiedMs += openWindows.reduce((t, w) => t + overlapMs(interval, w), 0);
    map.set(id, usage);
  }
  return map;
};

/** Totals across all stations: sessions started in the range and station-hours used. */
export const usageTotals = (usage: Map<string, StationUsage>) => {
  let sessions = 0;
  let occupiedMs = 0;
  for (const u of usage.values()) {
    sessions += u.sessions;
    occupiedMs += u.occupiedMs;
  }
  return { sessions, hours: occupiedMs / 3_600_000 };
};
