import crypto from "crypto";
import { Types } from "mongoose";
import PC, { IPC, PCStatus, StationType } from "../models/pc.model";
import GamingSession, { SessionStatus } from "../models/gamingsession.model";
import Reservation, {
  ACTIVE_RESERVATION_STATUSES,
  IReservation,
  ReservationSource,
  ReservationStatus,
} from "../models/reservation.model";
import ReservationSettings, {
  DEFAULT_SCHEDULE,
  IDaySchedule,
  IReservationSettings,
} from "../models/reservationSettings.model";
import { ApiError } from "../utils/apiError";
import logger from "../utils/logger";
import {
  addDays,
  formatDay,
  formatTime,
  isDateString,
  isTimeString,
  localDateString,
  timeToMinutes,
  weekdayOf,
  zonedDateTimeToUtc,
} from "../utils/time";
import gamingSessionService from "./gamingsession.service";
import customerService from "./customer.service";
import { CustomerSource } from "../models/customer.model";
import { DEFAULT_PHONE_COUNTRY, normalizePhone, phoneKeyOf, requirePhone } from "../utils/phone";

const MINUTE = 60_000;
/** A station that is busy right now is treated as unavailable for slots starting within this window. */
const OCCUPIED_HOLD_MINUTES = 60;
/** Staff can check a group in this long before their slot. */
const EARLY_CHECKIN_MINUTES = 30;
/** Max upcoming (confirmed) bookings one phone number can hold from the website. */
const MAX_ACTIVE_PER_PHONE = 3;
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export interface BusinessWindow {
  date: string;
  closed: boolean;
  start: Date;
  end: Date;
  open: string;
  close: string;
}

export interface CreateReservationInput {
  type: StationType;
  start: string;
  durationMinutes: number;
  stationIds?: string[];
  stationCount?: number;
  customerName: string;
  customerPhone: string;
  phoneCountry?: string;
  customerEmail?: string;
  notes?: string;
}

export interface UpdateReservationInput {
  start?: string;
  durationMinutes?: number;
  stationIds?: string[];
  customerName?: string;
  customerPhone?: string;
  phoneCountry?: string;
  customerEmail?: string;
  notes?: string;
}

export type SettingsUpdate = Partial<
  Pick<
    IReservationSettings,
    | "enabled"
    | "timezone"
    | "schedule"
    | "slotMinutes"
    | "minDurationMinutes"
    | "maxDurationMinutes"
    | "maxAdvanceDays"
    | "minLeadMinutes"
    | "noShowGraceMinutes"
    | "bufferMinutes"
    | "maxStationsPerBooking"
    | "bookableTypes"
  >
>;

const overlaps = (aStart: number, aEnd: number, bStart: number, bEnd: number) => aStart < bEnd && bStart < aEnd;

const stationId = (s: any): string => (s?._id ?? s).toString();

class ReservationService {
  private schedulerHandle: NodeJS.Timeout | null = null;

  // ---------------------------------------------------------------- settings

  async getSettings(): Promise<IReservationSettings> {
    const existing = await ReservationSettings.findOne({ key: "default" });
    if (existing) return existing;
    try {
      return await ReservationSettings.create({ key: "default", schedule: DEFAULT_SCHEDULE });
    } catch {
      // Created concurrently by another request
      return (await ReservationSettings.findOne({ key: "default" }))!;
    }
  }

  async updateSettings(update: SettingsUpdate, userId?: string): Promise<IReservationSettings> {
    const settings = await this.getSettings();

    if (update.timezone !== undefined) {
      try {
        new Intl.DateTimeFormat("en-US", { timeZone: update.timezone });
      } catch {
        throw ApiError.badRequest(`Unknown timezone "${update.timezone}"`);
      }
    }

    if (update.schedule !== undefined) {
      const byDay = new Map<number, IDaySchedule>();
      for (const d of update.schedule) {
        if (!Number.isInteger(d.day) || d.day < 0 || d.day > 6) throw ApiError.badRequest("Schedule day must be 0-6");
        if (!isTimeString(d.open) || !isTimeString(d.close)) throw ApiError.badRequest("Times must be HH:mm (24h)");
        if (!d.closed && d.open === d.close) throw ApiError.badRequest("Opening and closing time can't be the same");
        byDay.set(d.day, { day: d.day, closed: !!d.closed, open: d.open, close: d.close });
      }
      // Keep any days that weren't sent
      for (const d of settings.schedule) if (!byDay.has(d.day)) byDay.set(d.day, d);
      update.schedule = [...byDay.values()].sort((a, b) => a.day - b.day);
    }

    const next = { ...settings.toObject(), ...update };
    if (next.minDurationMinutes > next.maxDurationMinutes) {
      throw ApiError.badRequest("Minimum duration can't be longer than the maximum duration");
    }
    if (update.bookableTypes && update.bookableTypes.some((t) => !Object.values(StationType).includes(t))) {
      throw ApiError.badRequest("Unknown station type");
    }

    Object.assign(settings, update);
    if (userId) settings.updatedBy = new Types.ObjectId(userId);
    await settings.save();
    return settings;
  }

  /** Public, read-only view of the booking rules + how many stations of each type exist. */
  async getPublicConfig() {
    const s = await this.getSettings();
    const counts = await PC.aggregate([
      { $match: { isActive: true, status: { $ne: PCStatus.MAINTENANCE } } },
      { $group: { _id: { $ifNull: ["$type", StationType.PC] }, count: { $sum: 1 } } },
    ]);
    const stationCounts: Record<string, number> = { pc: 0, playstation: 0 };
    for (const c of counts) stationCounts[c._id] = c.count;

    return {
      enabled: s.enabled,
      timezone: s.timezone,
      schedule: s.schedule,
      slotMinutes: s.slotMinutes,
      minDurationMinutes: s.minDurationMinutes,
      maxDurationMinutes: s.maxDurationMinutes,
      maxAdvanceDays: s.maxAdvanceDays,
      minLeadMinutes: s.minLeadMinutes,
      noShowGraceMinutes: s.noShowGraceMinutes,
      maxStationsPerBooking: s.maxStationsPerBooking,
      bookableTypes: s.bookableTypes,
      stationCounts,
      today: localDateString(new Date(), s.timezone),
    };
  }

  // ---------------------------------------------------------------- windows

  /** Opening window of a business day (a night past midnight belongs to the day it started). */
  getBusinessWindow(settings: IReservationSettings, date: string): BusinessWindow {
    const day = settings.schedule.find((d) => d.day === weekdayOf(date)) ?? DEFAULT_SCHEDULE[weekdayOf(date)];
    const openMin = timeToMinutes(day.open);
    let closeMin = timeToMinutes(day.close);
    if (closeMin <= openMin) closeMin += 24 * 60;
    return {
      date,
      closed: day.closed,
      open: day.open,
      close: day.close,
      start: zonedDateTimeToUtc(date, openMin, settings.timezone),
      end: zonedDateTimeToUtc(date, closeMin, settings.timezone),
    };
  }

  /** Finds the (open) business window that fully contains [start, end), if any. */
  findWindowFor(settings: IReservationSettings, start: Date, end: Date): BusinessWindow | null {
    const local = localDateString(start, settings.timezone);
    for (const date of [local, addDays(local, -1)]) {
      const w = this.getBusinessWindow(settings, date);
      if (!w.closed && start >= w.start && end <= w.end) return w;
    }
    return null;
  }

  // ---------------------------------------------------------------- availability

  private async loadContext(type: StationType, from: Date, to: Date, excludeReservationId?: string) {
    const settings = await this.getSettings();
    const typeQuery = type === StationType.PC ? { $in: [StationType.PC, null] } : type;
    const stations = await PC.find({
      type: typeQuery,
      isActive: true,
      status: { $ne: PCStatus.MAINTENANCE },
    }).sort({ pcNumber: 1 });
    const ids = stations.map((s) => s._id);

    const buffer = settings.bufferMinutes * MINUTE;
    const [reservations, activeSessions] = await Promise.all([
      Reservation.find({
        stations: { $in: ids },
        status: { $in: ACTIVE_RESERVATION_STATUSES },
        startTime: { $lt: new Date(to.getTime() + buffer) },
        endTime: { $gt: new Date(from.getTime() - buffer) },
        ...(excludeReservationId ? { _id: { $ne: excludeReservationId } } : {}),
      }).select("stations startTime endTime"),
      GamingSession.find({ pc: { $in: ids }, status: SessionStatus.ACTIVE }).select("pc"),
    ]);

    const busyNow = new Set(activeSessions.map((s) => s.pc.toString()));
    for (const st of stations) if (st.status === PCStatus.OCCUPIED) busyNow.add(st._id.toString());

    return { settings, stations, reservations, busyNow, buffer };
  }

  private freeStations(
    ctx: Awaited<ReturnType<ReservationService["loadContext"]>>,
    start: Date,
    end: Date
  ): IPC[] {
    const now = Date.now();
    const s = start.getTime();
    const e = end.getTime();
    return ctx.stations.filter((st) => {
      const id = st._id.toString();
      if (ctx.busyNow.has(id) && s < now + OCCUPIED_HOLD_MINUTES * MINUTE) return false;
      return !ctx.reservations.some(
        (r) =>
          r.stations.some((x: any) => x.toString() === id) &&
          overlaps(s, e, r.startTime.getTime() - ctx.buffer, r.endTime.getTime() + ctx.buffer)
      );
    });
  }

  /** All bookable start times for a business day, with how many stations are free for each. */
  async getAvailability(params: { type: StationType; date: string; durationMinutes: number; staff?: boolean }) {
    const { type, date, durationMinutes, staff } = params;
    if (!Object.values(StationType).includes(type)) throw ApiError.badRequest("Unknown station type");
    if (!isDateString(date)) throw ApiError.badRequest("date must be YYYY-MM-DD");

    const settings = await this.getSettings();
    this.assertDuration(settings, durationMinutes, !!staff);

    const today = localDateString(new Date(), settings.timezone);
    // Allow "yesterday" too: just after midnight the current night still belongs to it
    if (date < addDays(today, -1)) throw ApiError.badRequest("That date is in the past");
    if (!staff && date > addDays(today, settings.maxAdvanceDays)) {
      throw ApiError.badRequest(`You can book up to ${settings.maxAdvanceDays} days ahead`);
    }

    const window = this.getBusinessWindow(settings, date);
    const base = {
      date,
      type,
      durationMinutes,
      timezone: settings.timezone,
      open: window.open,
      close: window.close,
      closed: window.closed,
      enabled: settings.enabled,
      typeEnabled: settings.bookableTypes.includes(type),
    };
    if (window.closed) return { ...base, stations: [], slots: [] };

    const ctx = await this.loadContext(type, window.start, window.end);
    const step = settings.slotMinutes * MINUTE;
    const earliest = Date.now() + (staff ? 0 : settings.minLeadMinutes * MINUTE);

    const slots = [];
    for (let t = window.start.getTime(); t + durationMinutes * MINUTE <= window.end.getTime(); t += step) {
      const start = new Date(t);
      const end = new Date(t + durationMinutes * MINUTE);
      const past = t < earliest;
      const free = past ? [] : this.freeStations(ctx, start, end);
      slots.push({
        start: start.toISOString(),
        end: end.toISOString(),
        label: formatTime(start, settings.timezone),
        endLabel: formatTime(end, settings.timezone),
        nextDay: localDateString(start, settings.timezone) !== date,
        status: past ? "past" : free.length ? "available" : "full",
        availableCount: free.length,
        availableStationIds: free.map((s) => s._id.toString()),
      });
    }

    return {
      ...base,
      stations: ctx.stations.map((s) => ({
        id: s._id.toString(),
        pcNumber: s.pcNumber,
        name: s.name,
        type: s.type ?? StationType.PC,
        location: s.location,
        hourlyRate: s.hourlyRate,
      })),
      slots,
    };
  }

  private assertDuration(settings: IReservationSettings, minutes: number, staff: boolean) {
    if (!Number.isFinite(minutes) || minutes <= 0) throw ApiError.badRequest("Invalid duration");
    if (staff) {
      if (minutes < 15 || minutes > 24 * 60) throw ApiError.badRequest("Duration must be between 15 minutes and 24 hours");
      return;
    }
    if (minutes < settings.minDurationMinutes || minutes > settings.maxDurationMinutes) {
      throw ApiError.badRequest(
        `Duration must be between ${settings.minDurationMinutes / 60}h and ${settings.maxDurationMinutes / 60}h`
      );
    }
    if (minutes % 15 !== 0) throw ApiError.badRequest("Duration must be in 15-minute steps");
  }

  // ---------------------------------------------------------------- create / update

  private async generateCode(): Promise<string> {
    for (let i = 0; i < 8; i++) {
      const bytes = crypto.randomBytes(6);
      const code = Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
      if (!(await Reservation.exists({ code }))) return code;
    }
    throw ApiError.internal("Could not generate a reservation code");
  }

  private estimateCost(stations: IPC[], minutes: number) {
    const hours = minutes / 60;
    const usd = stations.reduce((t, s) => t + (s.hourlyRate?.usd ?? 0), 0) * hours;
    const lbp = stations.reduce((t, s) => t + (s.hourlyRate?.lbp ?? 0), 0) * hours;
    return { usd: Math.round(usd * 100) / 100, lbp: Math.round(lbp) };
  }

  /** Validates timing rules and returns the stations to book. */
  private async resolveBooking(
    params: {
      type: StationType;
      start: Date;
      durationMinutes: number;
      stationIds?: string[];
      stationCount?: number;
      excludeReservationId?: string;
    },
    staff: boolean
  ) {
    const { type, start, durationMinutes } = params;
    if (isNaN(start.getTime())) throw ApiError.badRequest("Invalid start time");
    const settings = await this.getSettings();
    this.assertDuration(settings, durationMinutes, staff);
    const end = new Date(start.getTime() + durationMinutes * MINUTE);
    const now = Date.now();

    if (!staff) {
      if (!settings.enabled) throw ApiError.forbidden("Online reservations are currently closed. Please call us.");
      if (!settings.bookableTypes.includes(type)) throw ApiError.badRequest("This station type can't be booked online");
      if (start.getTime() < now + settings.minLeadMinutes * MINUTE) {
        throw ApiError.badRequest(`Bookings must start at least ${settings.minLeadMinutes} minutes from now`);
      }
      if (start.getTime() > now + (settings.maxAdvanceDays + 1) * 24 * 60 * MINUTE) {
        throw ApiError.badRequest(`You can book up to ${settings.maxAdvanceDays} days ahead`);
      }
      const window = this.findWindowFor(settings, start, end);
      if (!window) throw ApiError.badRequest("That time is outside our opening hours");
      if ((start.getTime() - window.start.getTime()) % (settings.slotMinutes * MINUTE) !== 0) {
        throw ApiError.badRequest("Please pick one of the listed start times");
      }
    } else if (start.getTime() < now - 60 * MINUTE) {
      throw ApiError.badRequest("Start time is in the past");
    }

    const wanted = params.stationIds?.length ? params.stationIds.length : params.stationCount ?? 1;
    if (!Number.isInteger(wanted) || wanted < 1) throw ApiError.badRequest("Pick at least one station");
    if (!staff && wanted > settings.maxStationsPerBooking) {
      throw ApiError.badRequest(`You can book up to ${settings.maxStationsPerBooking} stations at once`);
    }

    const ctx = await this.loadContext(type, start, end, params.excludeReservationId);
    const free = this.freeStations(ctx, start, end);

    let chosen: IPC[];
    if (params.stationIds?.length) {
      const unique = [...new Set(params.stationIds)];
      chosen = unique.map((id) => free.find((s) => s._id.toString() === id)).filter(Boolean) as IPC[];
      if (chosen.length !== unique.length) {
        throw ApiError.conflict("Some of the stations you picked were just booked. Please choose again.");
      }
    } else {
      if (free.length < wanted) {
        throw ApiError.conflict(
          free.length
            ? `Only ${free.length} station${free.length === 1 ? " is" : "s are"} free at that time`
            : "No stations are free at that time"
        );
      }
      chosen = free.slice(0, wanted);
    }
    return { settings, start, end, chosen };
  }

  /** Guards against two simultaneous requests grabbing the same station: the earlier booking wins. */
  private async assertNoRace(reservation: IReservation) {
    const clash = await Reservation.findOne({
      _id: { $ne: reservation._id },
      stations: { $in: reservation.stations },
      status: { $in: ACTIVE_RESERVATION_STATUSES },
      startTime: { $lt: reservation.endTime },
      endTime: { $gt: reservation.startTime },
      createdAt: { $lte: reservation.createdAt },
    });
    if (clash) {
      await Reservation.deleteOne({ _id: reservation._id });
      throw ApiError.conflict("Those stations were just booked by someone else. Please pick another time.");
    }
  }

  async createReservation(
    input: CreateReservationInput,
    opts: { staff: boolean; userId?: string }
  ): Promise<IReservation> {
    const name = input.customerName?.trim();
    if (!name) throw ApiError.badRequest("Name is required");
    const phone = requirePhone(input.customerPhone, input.phoneCountry);
    const phoneKey = phoneKeyOf(phone.e164);

    if (!opts.staff) {
      const active = await Reservation.countDocuments({
        phoneKey,
        status: ReservationStatus.CONFIRMED,
        endTime: { $gt: new Date() },
      });
      if (active >= MAX_ACTIVE_PER_PHONE) {
        throw ApiError.badRequest("You already have several upcoming bookings. Please call us to book more.");
      }
    }

    const { start, end, chosen } = await this.resolveBooking(
      {
        type: input.type,
        start: new Date(input.start),
        durationMinutes: input.durationMinutes,
        stationIds: input.stationIds,
        stationCount: input.stationCount,
      },
      opts.staff
    );

    const reservation = await Reservation.create({
      code: await this.generateCode(),
      type: input.type,
      stations: chosen.map((s) => s._id),
      startTime: start,
      endTime: end,
      durationMinutes: input.durationMinutes,
      customerName: name,
      customerPhone: phone.e164,
      phoneCountry: phone.country,
      phoneKey,
      customerEmail: input.customerEmail?.trim() || undefined,
      notes: input.notes?.trim() || undefined,
      status: ReservationStatus.CONFIRMED,
      source: opts.staff ? ReservationSource.POS : ReservationSource.WEBSITE,
      estimatedCost: this.estimateCost(chosen, input.durationMinutes),
      createdBy: opts.userId,
    });
    await this.assertNoRace(reservation);
    await this.linkCustomer(reservation);

    logger.info(
      `[RESERVATION] ${reservation.code} confirmed: ${chosen.map((s) => s.pcNumber).join(", ")} ` +
        `${start.toISOString()} (${input.durationMinutes}m) for ${name} via ${reservation.source}`
    );
    return reservation.populate("stations");
  }

  async updateReservation(id: string, input: UpdateReservationInput): Promise<IReservation> {
    const reservation = await this.getById(id);
    if (reservation.status !== ReservationStatus.CONFIRMED) {
      throw ApiError.badRequest("Only upcoming (confirmed) reservations can be changed");
    }

    const timingChanged = input.start !== undefined || input.durationMinutes !== undefined || input.stationIds !== undefined;
    if (timingChanged) {
      const durationMinutes = input.durationMinutes ?? reservation.durationMinutes;
      const { start, end, chosen } = await this.resolveBooking(
        {
          type: reservation.type,
          start: input.start ? new Date(input.start) : reservation.startTime,
          durationMinutes,
          stationIds: input.stationIds ?? reservation.stations.map(stationId),
          excludeReservationId: id,
        },
        true
      );
      reservation.startTime = start;
      reservation.endTime = end;
      reservation.durationMinutes = durationMinutes;
      reservation.stations = chosen.map((s) => s._id);
      reservation.estimatedCost = this.estimateCost(chosen, durationMinutes);
    }

    if (input.customerName !== undefined) reservation.customerName = input.customerName.trim();
    const phoneChanged = input.customerPhone !== undefined || input.phoneCountry !== undefined;
    if (phoneChanged) {
      const phone = requirePhone(input.customerPhone ?? reservation.customerPhone, input.phoneCountry ?? reservation.phoneCountry);
      reservation.customerPhone = phone.e164;
      reservation.phoneCountry = phone.country;
      reservation.phoneKey = phoneKeyOf(phone.e164);
    }
    if (input.customerEmail !== undefined) reservation.customerEmail = input.customerEmail.trim() || undefined;
    if (input.notes !== undefined) reservation.notes = input.notes.trim() || undefined;

    await reservation.save();
    if (phoneChanged || !reservation.customer) await this.linkCustomer(reservation);
    return reservation.populate("stations");
  }

  // ---------------------------------------------------------------- queries

  async getById(id: string): Promise<IReservation> {
    if (!Types.ObjectId.isValid(id)) throw ApiError.notFound("Reservation not found");
    const r = await Reservation.findById(id).populate("stations");
    if (!r) throw ApiError.notFound("Reservation not found");
    return r;
  }

  async list(filters: {
    date?: string;
    from?: string;
    to?: string;
    status?: string;
    type?: StationType;
    search?: string;
  }): Promise<IReservation[]> {
    const settings = await this.getSettings();
    const query: any = {};

    if (filters.date) {
      if (!isDateString(filters.date)) throw ApiError.badRequest("date must be YYYY-MM-DD");
      const w = this.getBusinessWindow(settings, filters.date);
      // Whole local day + the night after (covers bookings past midnight)
      const dayStart = zonedDateTimeToUtc(filters.date, 0, settings.timezone);
      query.startTime = { $gte: dayStart, $lt: new Date(Math.max(w.end.getTime(), dayStart.getTime() + 24 * 60 * MINUTE)) };
    } else if (filters.from || filters.to) {
      query.startTime = {};
      if (filters.from) query.startTime.$gte = new Date(filters.from);
      if (filters.to) query.startTime.$lt = new Date(filters.to);
    }
    if (filters.status) {
      const statuses = filters.status.split(",").filter((s) => Object.values(ReservationStatus).includes(s as any));
      if (statuses.length) query.status = { $in: statuses };
    }
    if (filters.type) query.type = filters.type;
    if (filters.search) {
      const term = filters.search.trim();
      const digits = term.replace(/\D/g, "");
      const or: any[] = [
        { customerName: { $regex: term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" } },
        { code: term.toUpperCase() },
      ];
      if (digits.length >= 4) or.push({ phoneKey: { $regex: digits.slice(-8) } });
      query.$or = or;
    }

    return Reservation.find(query).sort({ startTime: 1 }).limit(500).populate("stations").populate("createdBy", "name");
  }

  /** Next active reservation per station starting within `hours` (for station badges). */
  async getUpcomingByStation(hours = 12): Promise<Map<string, IReservation>> {
    const now = new Date();
    const reservations = await Reservation.find({
      status: { $in: ACTIVE_RESERVATION_STATUSES },
      endTime: { $gt: now },
      startTime: { $lt: new Date(now.getTime() + hours * 60 * MINUTE) },
    }).sort({ startTime: 1 });

    const map = new Map<string, IReservation>();
    for (const r of reservations) {
      for (const s of r.stations) {
        const id = s.toString();
        if (!map.has(id)) map.set(id, r);
      }
    }
    return map;
  }

  /**
   * Finds a booking by code + phone, whatever format the phone is typed in.
   * Normalized rows compare E.164 numbers; legacy rows fall back to the last 8 digits.
   */
  async lookup(code: string, phone: string, phoneCountry?: string): Promise<IReservation> {
    const r = await Reservation.findOne({ code: (code || "").trim().toUpperCase() }).populate("stations");
    if (!r || !this.phoneMatches(r, phone || "", phoneCountry)) {
      throw ApiError.notFound("We couldn't find a booking with that code and phone number");
    }
    return r;
  }

  private phoneMatches(r: IReservation, input: string, phoneCountry?: string): boolean {
    if (r.customerPhone?.startsWith("+")) {
      const typed = normalizePhone(input, phoneCountry || r.phoneCountry || DEFAULT_PHONE_COUNTRY);
      if (typed) return typed.e164 === r.customerPhone;
    }
    const key = phoneKeyOf(input);
    return key.length >= 7 && key === r.phoneKey;
  }

  /** Links the booking to a customer record (created on first booking). Never fails the booking. */
  private async linkCustomer(r: IReservation): Promise<void> {
    try {
      const customer = await customerService.findOrCreateByPhone(
        { name: r.customerName, phone: r.customerPhone, phoneCountry: r.phoneCountry, email: r.customerEmail },
        { source: CustomerSource.RESERVATION }
      );
      if (r.customer?.toString() !== customer._id.toString()) {
        r.customer = customer._id;
        await Reservation.updateOne({ _id: r._id }, { $set: { customer: customer._id } });
      }
    } catch (error) {
      logger.error(`[RESERVATION] Could not link ${r.code} to a customer`, error);
    }
  }

  // ---------------------------------------------------------------- status changes

  async cancelByCustomer(code: string, phone: string, phoneCountry?: string): Promise<IReservation> {
    const r = await this.lookup(code, phone, phoneCountry);
    if (r.status !== ReservationStatus.CONFIRMED) throw ApiError.badRequest("This booking can no longer be cancelled");
    if (r.startTime.getTime() <= Date.now()) throw ApiError.badRequest("This booking has already started");
    r.status = ReservationStatus.CANCELLED;
    r.cancelledAt = new Date();
    r.cancelledBy = "customer";
    await r.save();
    logger.info(`[RESERVATION] ${r.code} cancelled by customer`);
    return r;
  }

  async cancelByStaff(id: string, reason?: string): Promise<IReservation> {
    const r = await this.getById(id);
    if (r.status !== ReservationStatus.CONFIRMED) throw ApiError.badRequest("Only upcoming reservations can be cancelled");
    r.status = ReservationStatus.CANCELLED;
    r.cancelledAt = new Date();
    r.cancelledBy = "staff";
    r.cancelReason = reason?.trim() || undefined;
    await r.save();
    return r;
  }

  async markNoShow(id: string): Promise<IReservation> {
    const r = await this.getById(id);
    if (r.status !== ReservationStatus.CONFIRMED) throw ApiError.badRequest("Only upcoming reservations can be marked as no-show");
    r.status = ReservationStatus.NO_SHOW;
    r.noShowAt = new Date();
    await r.save();
    return r;
  }

  /** Customer arrived: start a gaming session on every reserved station. */
  async checkIn(id: string, userId: string): Promise<IReservation> {
    const r = await this.getById(id);
    if (r.status !== ReservationStatus.CONFIRMED) {
      throw ApiError.badRequest(
        r.status === ReservationStatus.NO_SHOW
          ? "This reservation was marked as a no-show. Create a new session instead."
          : "Only upcoming reservations can be checked in"
      );
    }
    const now = Date.now();
    if (now < r.startTime.getTime() - EARLY_CHECKIN_MINUTES * MINUTE) {
      throw ApiError.badRequest(`Check-in opens ${EARLY_CHECKIN_MINUTES} minutes before the booking`);
    }
    if (now > r.endTime.getTime()) throw ApiError.badRequest("This reservation has already ended");

    const stations = r.stations as unknown as IPC[];
    const busy = stations.filter((s) => s.status !== PCStatus.AVAILABLE || !s.isActive);
    if (busy.length) {
      throw ApiError.conflict(
        `${busy.map((s) => s.pcNumber).join(", ")} ${busy.length === 1 ? "is" : "are"} not free yet. ` +
          "End the current session or move the booking to another station."
      );
    }

    const sessionIds: Types.ObjectId[] = [];
    for (const st of stations) {
      // Each station gets its own order so friends can pay separately
      const session = await gamingSessionService.startSession(userId, {
        pcId: st._id.toString(),
        customerId: r.customer ? r.customer.toString() : undefined,
        customerName: r.customerName,
        notes: `Reservation ${r.code}`,
      });
      sessionIds.push(session._id);
    }

    r.status = ReservationStatus.CHECKED_IN;
    r.checkedInAt = new Date();
    r.checkedInBy = new Types.ObjectId(userId);
    r.sessions = sessionIds;
    await r.save();
    logger.info(`[RESERVATION] ${r.code} checked in (${stations.map((s) => s.pcNumber).join(", ")})`);
    return r.populate("stations");
  }

  // ---------------------------------------------------------------- background job

  /** Marks bookings as no-show once the grace period after their start has passed. */
  async releaseNoShows(): Promise<number> {
    const settings = await this.getSettings();
    const cutoff = new Date(Date.now() - settings.noShowGraceMinutes * MINUTE);
    const res = await Reservation.updateMany(
      { status: ReservationStatus.CONFIRMED, startTime: { $lte: cutoff } },
      { $set: { status: ReservationStatus.NO_SHOW, noShowAt: new Date() } }
    );
    if (res.modifiedCount) logger.info(`[RESERVATION] Released ${res.modifiedCount} no-show booking(s)`);
    return res.modifiedCount;
  }

  startScheduler(intervalMs = 60_000) {
    if (this.schedulerHandle) return;
    const run = () => this.releaseNoShows().catch((e) => logger.error("[RESERVATION] no-show job failed", e));
    run();
    this.schedulerHandle = setInterval(run, intervalMs);
    this.schedulerHandle.unref?.();
  }

  stopScheduler() {
    if (this.schedulerHandle) clearInterval(this.schedulerHandle);
    this.schedulerHandle = null;
  }

  // ---------------------------------------------------------------- serialization

  toPublic(r: IReservation, tz: string) {
    const stations = (r.stations as any[]).map((s) => ({
      pcNumber: s.pcNumber,
      name: s.name,
      type: s.type ?? StationType.PC,
    }));
    return {
      code: r.code,
      type: r.type,
      status: r.status,
      stations,
      startTime: r.startTime,
      endTime: r.endTime,
      durationMinutes: r.durationMinutes,
      customerName: r.customerName,
      estimatedCost: r.estimatedCost,
      display: {
        day: formatDay(r.startTime, tz),
        start: formatTime(r.startTime, tz),
        end: formatTime(r.endTime, tz),
      },
    };
  }

  toStaff(r: IReservation) {
    return {
      id: r._id.toString(),
      code: r.code,
      type: r.type,
      status: r.status,
      source: r.source,
      stations: (r.stations as any[]).map((s) =>
        s && s.pcNumber
          ? { id: s._id.toString(), pcNumber: s.pcNumber, name: s.name, type: s.type ?? StationType.PC, status: s.status }
          : { id: stationId(s) }
      ),
      startTime: r.startTime,
      endTime: r.endTime,
      durationMinutes: r.durationMinutes,
      customerName: r.customerName,
      customerPhone: r.customerPhone,
      phoneCountry: r.phoneCountry,
      customerId: r.customer ? r.customer.toString() : null,
      customerEmail: r.customerEmail,
      notes: r.notes,
      estimatedCost: r.estimatedCost,
      createdBy: r.createdBy && r.createdBy.name ? { id: r.createdBy._id.toString(), name: r.createdBy.name } : undefined,
      checkedInAt: r.checkedInAt,
      sessions: (r.sessions ?? []).map((s) => s.toString()),
      cancelledAt: r.cancelledAt,
      cancelledBy: r.cancelledBy,
      cancelReason: r.cancelReason,
      noShowAt: r.noShowAt,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    };
  }
}

export default new ReservationService();
