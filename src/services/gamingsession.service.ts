import GamingSession, {
  IGamingSession,
  SessionStatus,
  SessionPaymentStatus,
} from "../models/gamingsession.model";
import PC, { PCStatus } from "../models/pc.model";
import Sale, {
  SaleStatus,
  PaymentMethod,
  Currency,
} from "../models/sale.model";
import customerService from "./customer.service";
import discountService from "./discount.service";
import Discount, { DiscountTarget } from "../models/discount.model";
import { ApiError } from "../utils/apiError";

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

class GamingSessionService {
  private async generateSessionNumber(): Promise<string> {
    const date = new Date();
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");

    const lastSession = await GamingSession.findOne().sort({ createdAt: -1 });
    let sequence = 1;

    if (lastSession) {
      const lastSessionDate = lastSession.sessionNumber.substring(0, 8);
      const todayDate = `${year}${month}${day}`;

      if (lastSessionDate === todayDate) {
        const lastSequence = parseInt(
          lastSession.sessionNumber.substring(9),
          10
        );
        sequence = lastSequence + 1;
      }
    }

    return `${year}${month}${day}-${String(sequence).padStart(4, "0")}`;
  }

  async startSession(
    cashierId: string,
    data: {
      pcId: string;
      customerId?: string;
      customerName?: string;
      notes?: string;
    }
  ): Promise<IGamingSession> {
    // Verify PC exists and is available
    const pc = await PC.findById(data.pcId);
    if (!pc) {
      throw ApiError.notFound("PC not found");
    }

    if (pc.status !== PCStatus.AVAILABLE) {
      throw ApiError.badRequest("PC is not available");
    }

    if (!pc.isActive) {
      throw ApiError.badRequest("PC is not active");
    }

    // Check if customer exists if provided
    if (data.customerId) {
      await customerService.getCustomerById(data.customerId);
    }

    // Check for existing active session on this PC
    const existingSession = await GamingSession.findOne({
      pc: data.pcId,
      status: SessionStatus.ACTIVE,
    });

    if (existingSession) {
      throw ApiError.badRequest("PC already has an active session");
    }

    const sessionNumber = await this.generateSessionNumber();

    // Create session
    const session = await GamingSession.create({
      sessionNumber,
      pc: data.pcId,
      customer: data.customerId,
      customerName: data.customerName || "Walk-in",
      startTime: new Date(),
      hourlyRate: pc.hourlyRate,
      startedBy: cashierId,
      notes: data.notes,
      status: SessionStatus.ACTIVE,
      paymentStatus: SessionPaymentStatus.UNPAID,
    });

    // Update PC status
    pc.status = PCStatus.OCCUPIED;
    await pc.save();

    return await session.populate(["pc", "customer", "startedBy"]);
  }

  async endSession(
    sessionId: string,
    cashierId: string,
    discountId?: string
  ): Promise<IGamingSession> {
    const session = await GamingSession.findById(sessionId).populate("pc");

    if (!session) {
      throw ApiError.notFound("Session not found");
    }

    if (session.status !== SessionStatus.ACTIVE) {
      throw ApiError.badRequest("Session is not active");
    }

    // Calculate duration and cost
    const endTime = new Date();
    const durationMs = endTime.getTime() - session.startTime.getTime();
    const durationMinutes = Math.ceil(durationMs / (1000 * 60));
    const durationHours = durationMinutes / 60;

    const costUsd = session.hourlyRate.usd * durationHours;
    const costLbp = session.hourlyRate.lbp * durationHours;

    session.endTime = endTime;
    session.duration = durationMinutes;
    session.totalCost = {
      usd: Math.round(costUsd * 100) / 100,
      lbp: Math.round(costLbp),
    };

    // Apply discount if provided
    if (discountId) {
      const discountDoc = await Discount.findById(discountId);
      if (!discountDoc) {
        throw ApiError.notFound("Discount not found");
      }

      if (!discountDoc.isActive) {
        throw ApiError.badRequest(`Discount ${discountDoc.name} is not active`);
      }

      if (discountDoc.target !== DiscountTarget.GAMING_SESSION) {
        throw ApiError.badRequest(
          `Discount ${discountDoc.name} cannot be applied to gaming sessions`
        );
      }

      const discountAmount = discountService.calculateDiscountAmount(
        session.totalCost,
        discountDoc.value
      );

      session.discount = {
        discountId: discountDoc._id,
        discountName: discountDoc.name,
        percentage: discountDoc.value,
        amount: discountAmount,
      };

      session.finalAmount = {
        usd: session.totalCost.usd - discountAmount.usd,
        lbp: session.totalCost.lbp - discountAmount.lbp,
      };
    } else {
      // No discount, final amount equals total cost
      session.finalAmount = { ...session.totalCost };
    }

    session.status = SessionStatus.COMPLETED;
    session.endedBy = cashierId as any;

    await session.save();

    // Update PC status back to available
    const pc = await PC.findById(session.pc);
    if (pc) {
      pc.status = PCStatus.AVAILABLE;
      await pc.save();
    }

    return await session.populate([
      "pc",
      "customer",
      "startedBy",
      "endedBy",
      "sale",
    ]);
  }

  async processPayment(
    sessionId: string,
    paymentData: {
      paymentMethod: PaymentMethod;
      paymentCurrency: Currency;
      amount: number;
    }
  ): Promise<IGamingSession> {
    const session = await GamingSession.findById(sessionId).populate([
      "pc",
      "customer",
      "startedBy",
      "endedBy",
    ]);

    if (!session) {
      throw ApiError.notFound("Session not found");
    }

    if (session.status !== SessionStatus.COMPLETED) {
      throw ApiError.badRequest(
        "Can only process payment for completed sessions"
      );
    }

    if (session.paymentStatus === SessionPaymentStatus.PAID) {
      throw ApiError.badRequest("Session is already paid");
    }

    // Verify payment amount - use finalAmount which includes discounts
    const totalDue =
      paymentData.paymentCurrency === Currency.USD
        ? session.finalAmount.usd
        : session.finalAmount.lbp;

    if (paymentData.amount < totalDue) {
      throw ApiError.badRequest("Insufficient payment amount");
    }

    // Create a sale record for this session
    const saleData = {
      customer: session.customer?._id,
      items: [
        {
          // Create a virtual product for gaming session
          product: session.pc._id,
          productName: `Gaming - ${(session.pc as any).name}`,
          productSku: `GAMING-${(session.pc as any).pcNumber}`,
          quantity: 1,
          unitPrice: session.totalCost,
          discount: session.discount,
          subtotal: session.totalCost,
          finalAmount: session.finalAmount,
        },
      ],
      subtotalBeforeDiscount: session.totalCost,
      totalItemDiscounts: session.discount
        ? session.discount.amount
        : { usd: 0, lbp: 0 },
      totals: session.finalAmount,
      paymentMethod: paymentData.paymentMethod,
      paymentCurrency: paymentData.paymentCurrency,
      amountPaid:
        paymentData.paymentCurrency === Currency.USD
          ? {
              usd: paymentData.amount,
              lbp: paymentData.amount * 89500, // Use actual rate from config
            }
          : {
              usd: paymentData.amount / 89500,
              lbp: paymentData.amount,
            },
      status: SaleStatus.PAID,
      cashier: session.endedBy || session.startedBy,
      notes: `Gaming Session: ${session.sessionNumber} - Duration: ${Math.floor(
        session.duration! / 60
      )}h ${session.duration! % 60}m${
        session.discount ? ` - Discount Applied: ${session.discount.discountName}` : ""
      }`,
      paidAt: new Date(),
    };

    // Generate invoice number for sale
    const date = new Date();
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");

    const lastSale = await Sale.findOne().sort({ createdAt: -1 });
    let sequence = 1;

    if (lastSale) {
      const lastInvoiceDate = lastSale.invoiceNumber.substring(0, 8);
      const todayDate = `${year}${month}${day}`;

      if (lastInvoiceDate === todayDate) {
        const lastSequence = parseInt(lastSale.invoiceNumber.substring(9), 10);
        sequence = lastSequence + 1;
      }
    }

    const invoiceNumber = `${year}${month}${day}-${String(sequence).padStart(
      4,
      "0"
    )}`;

    const sale = await Sale.create({
      invoiceNumber,
      ...saleData,
    });

    // Update session with sale reference
    session.sale = sale._id;
    session.paymentStatus = SessionPaymentStatus.PAID;
    await session.save();

    // Update customer stats if applicable - use finalAmount which includes discounts
    if (session.customer) {
      await customerService.updatePurchaseStats(
        session.customer._id.toString(),
        session.finalAmount.usd
      );
    }

    return await session.populate([
      "pc",
      "customer",
      "startedBy",
      "endedBy",
      "sale",
    ]);
  }

  async getSessionById(id: string): Promise<IGamingSession> {
    const session = await GamingSession.findById(id).populate([
      "pc",
      "customer",
      "startedBy",
      "endedBy",
      "sale",
    ]);

    if (!session) {
      throw ApiError.notFound("Session not found");
    }

    return session;
  }

  async getAllSessions(filters: SessionFilters): Promise<{
    sessions: IGamingSession[];
    total: number;
    page: number;
    totalPages: number;
  }> {
    const {
      status,
      pcId,
      customerId,
      startDate,
      endDate,
      paymentStatus,
      page = 1,
      limit = 20,
    } = filters;

    const query: any = {};

    if (status) {
      query.status = status;
    }

    if (pcId) {
      query.pc = pcId;
    }

    if (customerId) {
      query.customer = customerId;
    }

    if (paymentStatus) {
      query.paymentStatus = paymentStatus;
    }

    if (startDate || endDate) {
      query.startTime = {};

      if (startDate) {
        const start = new Date(startDate);
        start.setHours(0, 0, 0, 0);
        query.startTime.$gte = start;
      }

      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        query.startTime.$lte = end;
      }
    }

    const skip = (page - 1) * limit;

    const [sessions, total] = await Promise.all([
      GamingSession.find(query)
        .populate("pc", "pcNumber name")
        .populate("customer", "name phone")
        .populate("startedBy", "name")
        .populate("endedBy", "name")
        .sort({ startTime: -1 })
        .skip(skip)
        .limit(limit),
      GamingSession.countDocuments(query),
    ]);

    return {
      sessions,
      total,
      page,
      totalPages: Math.ceil(total / limit),
    };
  }

  async getActiveSessions(): Promise<IGamingSession[]> {
    return await GamingSession.find({
      status: SessionStatus.ACTIVE,
    })
      .populate("pc", "pcNumber name status")
      .populate("customer", "name phone")
      .populate("startedBy", "name")
      .sort({ startTime: 1 });
  }

  async getCurrentCost(sessionId: string): Promise<{
    duration: number;
    cost: { usd: number; lbp: number };
  }> {
    const session = await GamingSession.findById(sessionId);

    if (!session) {
      throw ApiError.notFound("Session not found");
    }

    if (session.status !== SessionStatus.ACTIVE) {
      throw ApiError.badRequest("Session is not active");
    }

    const now = new Date();
    const durationMs = now.getTime() - session.startTime.getTime();
    const durationMinutes = Math.ceil(durationMs / (1000 * 60));
    const durationHours = durationMinutes / 60;

    const costUsd = session.hourlyRate.usd * durationHours;
    const costLbp = session.hourlyRate.lbp * durationHours;

    return {
      duration: durationMinutes,
      cost: {
        usd: Math.round(costUsd * 100) / 100,
        lbp: Math.round(costLbp),
      },
    };
  }

  async cancelSession(
    sessionId: string,
    cashierId: string
  ): Promise<IGamingSession> {
    const session = await GamingSession.findById(sessionId).populate("pc");

    if (!session) {
      throw ApiError.notFound("Session not found");
    }

    if (session.status !== SessionStatus.ACTIVE) {
      throw ApiError.badRequest("Can only cancel active sessions");
    }

    session.status = SessionStatus.CANCELLED;
    session.endTime = new Date();
    session.endedBy = cashierId as any;
    await session.save();

    // Update PC status back to available
    const pc = await PC.findById(session.pc);
    if (pc) {
      pc.status = PCStatus.AVAILABLE;
      await pc.save();
    }

    return await session.populate(["pc", "customer", "startedBy", "endedBy"]);
  }

  async getTodayStats(): Promise<{
    activeSessions: number;
    completedSessions: number;
    totalRevenue: { usd: number; lbp: number };
    unpaidSessions: number;
  }> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const sessions = await GamingSession.find({
      startTime: { $gte: today, $lt: tomorrow },
    });

    const activeSessions = sessions.filter(
      (s) => s.status === SessionStatus.ACTIVE
    ).length;

    const completedSessions = sessions.filter(
      (s) => s.status === SessionStatus.COMPLETED
    ).length;

    const paidSessions = sessions.filter(
      (s) => s.paymentStatus === SessionPaymentStatus.PAID
    );

    const totalRevenue = paidSessions.reduce(
      (acc, session) => ({
        usd: acc.usd + (session.finalAmount?.usd || session.totalCost?.usd || 0),
        lbp: acc.lbp + (session.finalAmount?.lbp || session.totalCost?.lbp || 0),
      }),
      { usd: 0, lbp: 0 }
    );

    const unpaidSessions = sessions.filter(
      (s) =>
        s.status === SessionStatus.COMPLETED &&
        s.paymentStatus === SessionPaymentStatus.UNPAID
    ).length;

    return {
      activeSessions,
      completedSessions,
      totalRevenue,
      unpaidSessions,
    };
  }
}

export default new GamingSessionService();
