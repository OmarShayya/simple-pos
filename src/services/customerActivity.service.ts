import { Types } from "mongoose";
import GamingSession, { IGamingSession, SessionPaymentStatus, SessionStatus } from "../models/gamingsession.model";
import { IPC, StationType } from "../models/pc.model";
import Reservation, { IReservation, ReservationStatus } from "../models/reservation.model";
import Sale, { SaleRecord, SaleStatus } from "../models/sale.model";
import { toOrderRow } from "../presenters/order.presenter";
import { roundUsd } from "../utils/money";
import { localDateString } from "../utils/time";
import customerService from "./customer.service";
import { sessionCharge } from "./gaming/sessionClock";
import { getLoungeTimezone } from "./loungeSettings";
import { toLiveOrders } from "./orders/liveOrders";

const RECENT = 20;

const toReservationRow = (r: IReservation) => ({
  id: r._id.toString(),
  code: r.code,
  type: r.type,
  status: r.status,
  source: r.source,
  startTime: r.startTime,
  endTime: r.endTime,
  durationMinutes: r.durationMinutes,
  stations: (r.stations as IPC[]).map((s) => s?.pcNumber).filter(Boolean),
  estimatedCost: r.estimatedCost,
});

const toSessionRow = (s: IGamingSession) => {
  const pc = s.pc as IPC | null;
  const running = s.status === SessionStatus.ACTIVE;
  const live = running ? sessionCharge(s) : null;
  return {
    id: s._id.toString(),
    sessionNumber: s.sessionNumber,
    station: pc?.pcNumber ? { pcNumber: pc.pcNumber, name: pc.name, type: pc.type ?? StationType.PC } : null,
    startTime: s.startTime,
    endTime: s.endTime,
    durationMinutes: live ? live.minutes : s.duration ?? 0,
    status: s.status,
    paymentStatus: s.paymentStatus,
    amount: live ? live.cost : s.finalAmount,
    orderId: s.sale ? s.sale.toString() : null,
  };
};

class CustomerActivityService {
  /** Recent orders, bookings and sessions of a customer, plus lifetime totals. */
  async getActivity(customerId: string) {
    const customer = await customerService.getCustomerById(customerId);
    const id = customer._id as Types.ObjectId;
    const tz = await getLoungeTimezone();

    const [orderRecords, reservations, sessions, paidOrders, visitSessions] = await Promise.all([
      Sale.find({ customer: id })
        .populate([
          { path: "customer", select: "name phone" },
          { path: "cashier", select: "name" },
          { path: "paidBy", select: "name" },
        ])
        .sort({ createdAt: -1 })
        .limit(RECENT)
        .lean<SaleRecord[]>(),
      // Bookings made before customers were linked are matched by phone
      Reservation.find({ $or: [{ customer: id }, { customerPhone: customer.phone }] })
        .sort({ startTime: -1 })
        .limit(RECENT)
        .populate("stations", "pcNumber"),
      GamingSession.find({ customer: id }).sort({ startTime: -1 }).limit(RECENT).populate("pc", "pcNumber name type"),
      Sale.find({ customer: id, status: SaleStatus.PAID }).select("totals paidAt createdAt").lean<SaleRecord[]>(),
      GamingSession.find({ customer: id, status: { $ne: SessionStatus.CANCELLED } })
        .select("startTime sale paymentStatus isBillable finalAmount")
        .lean<IGamingSession[]>(),
    ]);

    // Spend = paid orders + legacy paid sessions that never had an order (no double counting)
    const legacyPaid = visitSessions.filter(
      (s) => !s.sale && s.paymentStatus === SessionPaymentStatus.PAID && s.isBillable !== false
    );
    const spentUsd = roundUsd(
      paidOrders.reduce((t, o) => t + (o.totals?.usd ?? 0), 0) + legacyPaid.reduce((t, s) => t + (s.finalAmount?.usd ?? 0), 0)
    );

    // A visit = a lounge-local day with a paid order or a gaming session
    const moments = [
      ...paidOrders.map((o) => o.paidAt ?? o.createdAt),
      ...visitSessions.map((s) => s.startTime),
    ].filter((d): d is Date => !!d);
    const visits = new Set(moments.map((d) => localDateString(d, tz))).size;
    const lastVisit = moments.length ? new Date(Math.max(...moments.map((d) => d.getTime()))) : null;

    const orders = await toLiveOrders(orderRecords);
    return {
      orders: orders.map(toOrderRow),
      reservations: reservations.map(toReservationRow),
      sessions: sessions.map(toSessionRow),
      totals: {
        spentUsd,
        visits,
        lastVisit,
        orders: paidOrders.length,
        reservations: await Reservation.countDocuments({
          $or: [{ customer: id }, { customerPhone: customer.phone }],
          status: { $ne: ReservationStatus.CANCELLED },
        }),
      },
    };
  }
}

export default new CustomerActivityService();
