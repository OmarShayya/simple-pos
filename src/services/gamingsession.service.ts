import { FilterQuery, Types } from "mongoose";
import GamingSession, { IGamingSession, SessionStatus, SessionPaymentStatus } from "../models/gamingsession.model";
import PC, { IPC, PCStatus } from "../models/pc.model";
import Sale, { Currency, SaleStatus } from "../models/sale.model";
import { CustomerSource, ICustomer } from "../models/customer.model";
import customerService from "./customer.service";
import { ApiError } from "../utils/apiError";
import socketService from "./socket.service";
import logger from "../utils/logger";
import { localDateRange } from "../utils/period";
import { localDateString } from "../utils/time";
import { clampMoney, percentOf, roundMoney, subtractMoney, sumMoney } from "../utils/money";
import { createWithDailyCode } from "./numbering";
import { getLoungeTimezone } from "./loungeSettings";
import { sessionCharge } from "./gaming/sessionClock";
import { releaseStation, settleSessionOnOrder, stopSessionClock } from "./gaming/sessionLifecycle";
import { resolveDiscount } from "./orders/discountRules";
import { attachSessionToOrder, detachCancelledSession, loadOrderForNewSession } from "./orders/sessionOrders";
import { payOrder, PaymentInput } from "./orders/orderPayment";

interface SessionFilters {
  status?: SessionStatus;
  pcId?: string;
  customerId?: string;
  startDate?: string;
  endDate?: string;
  paymentStatus?: SessionPaymentStatus;
  page?: number;
  limit?: number;
}

export interface StartSessionInput {
  pcId: string;
  customerId?: string;
  customerName?: string;
  /** Links (or auto-creates) the customer by phone when no customerId is given */
  customerPhone?: string;
  phoneCountry?: string;
  /** Add the session to this pending order instead of opening a new one */
  saleId?: string;
  /** Deprecated: every session now lives on an order. Accepted and ignored. */
  createSale?: boolean;
  notes?: string;
}

const POPULATE_FULL = ["pc", "customer", "startedBy", "endedBy", "sale"];

class GamingSessionService {
  private async createSessionRecord(fields: Partial<IGamingSession>): Promise<IGamingSession> {
    return createWithDailyCode({
      lastCode: async (pattern) => {
        const last = await GamingSession.findOne({ sessionNumber: pattern })
          .sort({ sessionNumber: -1 })
          .select("sessionNumber")
          .lean<{ sessionNumber: string }>();
        return last?.sessionNumber ?? null;
      },
      create: (sessionNumber) => GamingSession.create({ ...fields, sessionNumber }),
    });
  }

  private async assertStationFree(pcId: string): Promise<IPC> {
    const pc = Types.ObjectId.isValid(pcId) ? await PC.findById(pcId) : null;
    if (!pc) throw ApiError.notFound("PC not found");
    if (pc.status !== PCStatus.AVAILABLE) throw ApiError.badRequest("PC is not available");
    if (!pc.isActive) throw ApiError.badRequest("PC is not active");
    if (await GamingSession.exists({ pc: pc._id, status: SessionStatus.ACTIVE })) {
      throw ApiError.badRequest("PC already has an active session");
    }
    return pc;
  }

  private async resolveCustomer(data: StartSessionInput): Promise<ICustomer | null> {
    if (data.customerId) return customerService.getCustomerById(data.customerId);
    if (data.customerPhone?.trim()) {
      return customerService.findOrCreateByPhone(
        { name: data.customerName, phone: data.customerPhone, phoneCountry: data.phoneCountry },
        { source: CustomerSource.POS }
      );
    }
    return null;
  }

  /** Starts a session. It always lands on an order: a new pending one, or `saleId`. */
  async startSession(cashierId: string, data: StartSessionInput): Promise<IGamingSession> {
    const station = await this.assertStationFree(data.pcId);
    const customer = await this.resolveCustomer(data);
    const existingOrder = data.saleId ? await loadOrderForNewSession(data.saleId, customer) : null;
    const orderId = existingOrder?._id ?? new Types.ObjectId();
    const typedName = data.customerName?.trim();

    const session = await this.createSessionRecord({
      pc: station._id,
      customer: customer?._id,
      customerName: typedName || customer?.name || "Walk-in",
      startTime: new Date(),
      hourlyRate: { usd: station.hourlyRate.usd, lbp: station.hourlyRate.lbp },
      totalCost: { usd: 0, lbp: 0 },
      finalAmount: { usd: 0, lbp: 0 },
      startedBy: new Types.ObjectId(cashierId),
      sale: orderId,
      notes: data.notes,
      status: SessionStatus.ACTIVE,
      paymentStatus: SessionPaymentStatus.UNPAID,
      isBillable: true,
    });

    try {
      await attachSessionToOrder({
        order: existingOrder,
        orderId,
        session,
        station,
        cashierId,
        customer,
        customerName: typedName,
      });
    } catch (error) {
      await GamingSession.deleteOne({ _id: session._id });
      throw error;
    }

    station.status = PCStatus.OCCUPIED;
    await station.save();
    const unlocked = socketService.unlockPC(station.pcNumber);
    logger.info(
      `[GAMING SESSION] ${session.sessionNumber} started on ${station.pcNumber} (order ${orderId}, ` +
        `unlock sent: ${unlocked ? "yes" : "no — PC agent offline"})`
    );

    return session.populate(["pc", "customer", "startedBy", "sale"]);
  }

  private async getActiveSession(sessionId: string): Promise<IGamingSession> {
    const session = Types.ObjectId.isValid(sessionId) ? await GamingSession.findById(sessionId).populate("pc") : null;
    if (!session) throw ApiError.notFound("Session not found");
    if (session.status !== SessionStatus.ACTIVE) throw ApiError.badRequest("Session is not active");
    return session;
  }

  /** Ends a session: final duration/price go on the order line and the order totals are recomputed. */
  async endSession(sessionId: string, cashierId: string, discountId?: string): Promise<IGamingSession> {
    const session = await this.getActiveSession(sessionId);
    const discount = discountId ? await resolveDiscount(discountId, { on: "gaming" }) : undefined;

    stopSessionClock(session, new Date(), cashierId);

    const order = session.sale ? await Sale.findById(session.sale) : null;
    if (order && order.status === SaleStatus.PENDING) {
      settleSessionOnOrder(order, session, discount);
      await order.save();
    } else if (discount) {
      // Legacy session without an order
      const amount = percentOf(session.totalCost, discount.percentage);
      session.discount = { ...discount, amount };
      session.finalAmount = clampMoney(roundMoney(subtractMoney(session.totalCost, amount)));
    }

    await session.save();
    await releaseStation(session.pc);
    logger.info(
      `[GAMING SESSION] ${session.sessionNumber} ended: ${session.duration} min, $${session.finalAmount.usd}`
    );

    return session.populate(POPULATE_FULL);
  }

  /**
   * Kept for older clients: pays the session's ORDER (ending the session first if it is running).
   * Legacy sessions that never had an order are paid directly, as before.
   */
  async processPayment(sessionId: string, payment: PaymentInput, userId?: string): Promise<IGamingSession> {
    const session = Types.ObjectId.isValid(sessionId) ? await GamingSession.findById(sessionId).populate("pc") : null;
    if (!session) throw ApiError.notFound("Session not found");
    if (session.status === SessionStatus.CANCELLED) {
      throw ApiError.badRequest("Cannot process payment for cancelled session");
    }
    if (session.paymentStatus === SessionPaymentStatus.PAID) throw ApiError.badRequest("Session is already paid");

    if (session.sale) {
      await payOrder(session.sale.toString(), payment, userId);
      return this.getSessionById(sessionId);
    }

    // Legacy standalone session
    if (session.status === SessionStatus.ACTIVE) {
      stopSessionClock(session, new Date(), userId);
      await releaseStation(session.pc);
    }
    const due = payment.paymentCurrency === Currency.USD ? session.finalAmount.usd : session.finalAmount.lbp;
    if (payment.amount < due) throw ApiError.badRequest("Insufficient payment amount");
    session.paymentStatus = SessionPaymentStatus.PAID;
    await session.save();
    if (session.customer) {
      await customerService.updatePurchaseStats(session.customer.toString(), session.finalAmount.usd);
    }
    return session.populate(POPULATE_FULL);
  }

  async getSessionById(id: string): Promise<IGamingSession> {
    const session = Types.ObjectId.isValid(id) ? await GamingSession.findById(id).populate(POPULATE_FULL) : null;
    if (!session) throw ApiError.notFound("Session not found");
    return session;
  }

  async getAllSessions(filters: SessionFilters): Promise<{
    sessions: IGamingSession[];
    total: number;
    page: number;
    totalPages: number;
  }> {
    const { status, pcId, customerId, startDate, endDate, paymentStatus, page = 1, limit = 20 } = filters;
    const query: FilterQuery<IGamingSession> = {};

    if (status) query.status = status;
    if (pcId) query.pc = pcId;
    if (customerId) query.customer = customerId;
    if (paymentStatus) query.paymentStatus = paymentStatus;

    if (startDate || endDate) {
      const tz = await getLoungeTimezone();
      const range = localDateRange(tz, startDate?.slice(0, 10), endDate?.slice(0, 10));
      query.startTime = { ...(range.start ? { $gte: range.start } : {}), ...(range.end ? { $lt: range.end } : {}) };
    }

    const skip = (page - 1) * limit;
    const [sessions, total] = await Promise.all([
      GamingSession.find(query)
        .populate("pc", "pcNumber name type")
        .populate("customer", "name phone")
        .populate("startedBy", "name")
        .populate("endedBy", "name")
        .sort({ startTime: -1 })
        .skip(skip)
        .limit(limit),
      GamingSession.countDocuments(query),
    ]);

    return { sessions, total, page, totalPages: Math.ceil(total / limit) };
  }

  async getActiveSessions(): Promise<IGamingSession[]> {
    return await GamingSession.find({ status: SessionStatus.ACTIVE })
      .populate("pc", "pcNumber name status type")
      .populate("customer", "name phone")
      .populate("startedBy", "name")
      .sort({ startTime: 1 });
  }

  async getCurrentCost(sessionId: string): Promise<{ duration: number; cost: { usd: number; lbp: number } }> {
    const session = Types.ObjectId.isValid(sessionId) ? await GamingSession.findById(sessionId) : null;
    if (!session) throw ApiError.notFound("Session not found");
    if (session.status !== SessionStatus.ACTIVE) throw ApiError.badRequest("Session is not active");
    const { minutes, cost } = sessionCharge(session);
    return { duration: minutes, cost };
  }

  async cancelSession(sessionId: string, cashierId: string): Promise<IGamingSession> {
    const session = Types.ObjectId.isValid(sessionId) ? await GamingSession.findById(sessionId).populate("pc") : null;
    if (!session) throw ApiError.notFound("Session not found");
    if (session.status !== SessionStatus.ACTIVE) throw ApiError.badRequest("Can only cancel active sessions");

    session.status = SessionStatus.CANCELLED;
    session.endTime = new Date();
    session.endedBy = new Types.ObjectId(cashierId);
    await session.save();

    await detachCancelledSession(session);
    await releaseStation(session.pc);
    logger.info(`[GAMING SESSION] ${session.sessionNumber} cancelled`);

    return session.populate(["pc", "customer", "startedBy", "endedBy"]);
  }

  /** Ends whatever session is running on a station (used by the station "unlock" action). */
  async endActiveSessionOnStation(pcId: string, cashierId: string): Promise<IGamingSession | null> {
    const active = await GamingSession.findOne({ pc: pcId, status: SessionStatus.ACTIVE }).select("_id");
    return active ? this.endSession(active._id.toString(), cashierId) : null;
  }

  async getTodayStats(): Promise<{
    activeSessions: number;
    completedSessions: number;
    totalRevenue: { usd: number; lbp: number };
    unpaidSessions: number;
  }> {
    const tz = await getLoungeTimezone();
    const today = localDateString(new Date(), tz);
    const { start, end } = localDateRange(tz, today, today);
    const sessions = await GamingSession.find({ startTime: { $gte: start, $lt: end } });

    const billable = sessions.filter((s) => s.isBillable !== false);
    const paid = billable.filter((s) => s.paymentStatus === SessionPaymentStatus.PAID);

    return {
      activeSessions: sessions.filter((s) => s.status === SessionStatus.ACTIVE).length,
      completedSessions: sessions.filter((s) => s.status === SessionStatus.COMPLETED).length,
      totalRevenue: roundMoney(sumMoney(paid, (s) => (s.finalAmount?.usd || s.finalAmount?.lbp ? s.finalAmount : s.totalCost))),
      unpaidSessions: billable.filter(
        (s) => s.status === SessionStatus.COMPLETED && s.paymentStatus === SessionPaymentStatus.UNPAID
      ).length,
    };
  }
}

export default new GamingSessionService();
