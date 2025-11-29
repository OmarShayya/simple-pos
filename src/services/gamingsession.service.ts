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
import socketService from "./socket.service";

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
      saleId?: string;
      notes?: string;
    }
  ): Promise<IGamingSession> {
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

    if (data.customerId) {
      await customerService.getCustomerById(data.customerId);
    }

    const existingSession = await GamingSession.findOne({
      pc: data.pcId,
      status: SessionStatus.ACTIVE,
    });

    if (existingSession) {
      throw ApiError.badRequest("PC already has an active session");
    }

    const sessionNumber = await this.generateSessionNumber();

    const sessionItem = {
      product: pc._id,
      productName: `Gaming Session - ${pc.pcNumber}`,
      productSku: `SESSION-${sessionNumber}`,
      quantity: 1,
      unitPrice: { usd: 0, lbp: 0 },
      subtotal: { usd: 0, lbp: 0 },
      finalAmount: { usd: 0, lbp: 0 },
    };

    let sale;
    if (data.saleId) {
      sale = await Sale.findById(data.saleId);
      if (!sale) {
        throw ApiError.notFound("Sale not found");
      }
      if (sale.status !== SaleStatus.PENDING) {
        throw ApiError.badRequest("Can only add gaming session to pending sales");
      }
      if (data.customerId && sale.customer?.toString() !== data.customerId) {
        throw ApiError.badRequest("Sale customer does not match session customer");
      }
      sale.items.push(sessionItem as any);
      await sale.save();
    } else {
      const invoiceNumber = await this.generateInvoiceNumber();
      sale = await Sale.create({
        invoiceNumber,
        customer: data.customerId,
        items: [sessionItem],
        subtotalBeforeDiscount: { usd: 0, lbp: 0 },
        totalItemDiscounts: { usd: 0, lbp: 0 },
        totals: { usd: 0, lbp: 0 },
        cashier: cashierId,
        status: SaleStatus.PENDING,
      });
    }

    const session = await GamingSession.create({
      sessionNumber,
      pc: data.pcId,
      customer: data.customerId,
      customerName: data.customerName || "Walk-in",
      startTime: new Date(),
      hourlyRate: pc.hourlyRate,
      totalCost: { usd: 0, lbp: 0 },
      finalAmount: { usd: 0, lbp: 0 },
      startedBy: cashierId,
      sale: sale._id,
      notes: data.notes,
      status: SessionStatus.ACTIVE,
      paymentStatus: SessionPaymentStatus.UNPAID,
    });

    pc.status = PCStatus.OCCUPIED;
    await pc.save();

    socketService.unlockPC(pc.pcNumber);

    return await session.populate(["pc", "customer", "startedBy", "sale"]);
  }

  private async generateInvoiceNumber(): Promise<string> {
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

    return `${year}${month}${day}-${String(sequence).padStart(4, "0")}`;
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

    let discountData = undefined;
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

      discountData = {
        discountId: discountDoc._id,
        discountName: discountDoc.name,
        percentage: discountDoc.value,
        amount: discountAmount,
      };

      session.discount = discountData;
      session.finalAmount = {
        usd: session.totalCost.usd - discountAmount.usd,
        lbp: session.totalCost.lbp - discountAmount.lbp,
      };
    } else {
      session.finalAmount = { ...session.totalCost };
    }

    session.status = SessionStatus.COMPLETED;
    session.endedBy = cashierId as any;

    await session.save();

    const sale = await Sale.findById(session.sale);
    if (sale) {
      const sessionItem = sale.items.find(
        (item) => item.productSku === `SESSION-${session.sessionNumber}`
      );

      if (sessionItem) {
        sessionItem.unitPrice = session.totalCost;
        sessionItem.subtotal = session.totalCost;
        sessionItem.discount = discountData;
        sessionItem.finalAmount = session.finalAmount;

        sale.subtotalBeforeDiscount = sale.items.reduce(
          (acc, item) => ({
            usd: acc.usd + item.subtotal.usd,
            lbp: acc.lbp + item.subtotal.lbp,
          }),
          { usd: 0, lbp: 0 }
        );

        sale.totalItemDiscounts = sale.items.reduce(
          (acc, item) => ({
            usd: acc.usd + (item.discount?.amount.usd || 0),
            lbp: acc.lbp + (item.discount?.amount.lbp || 0),
          }),
          { usd: 0, lbp: 0 }
        );

        let totals = {
          usd: sale.subtotalBeforeDiscount.usd - sale.totalItemDiscounts.usd,
          lbp: sale.subtotalBeforeDiscount.lbp - sale.totalItemDiscounts.lbp,
        };

        if (sale.saleDiscount) {
          totals = {
            usd: totals.usd - sale.saleDiscount.amount.usd,
            lbp: totals.lbp - sale.saleDiscount.amount.lbp,
          };
        }

        sale.totals = totals;
        await sale.save();
      }
    }

    const pc = await PC.findById(session.pc);
    if (pc) {
      pc.status = PCStatus.AVAILABLE;
      await pc.save();

      socketService.lockPC(pc.pcNumber);
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
    let session = await GamingSession.findById(sessionId).populate(["sale", "pc"]);

    if (!session) {
      throw ApiError.notFound("Session not found");
    }

    if (session.status === SessionStatus.ACTIVE) {
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
      session.finalAmount = { ...session.totalCost };
      session.status = SessionStatus.COMPLETED;

      await session.save();

      const sale = await Sale.findById(session.sale);
      if (sale) {
        const sessionItem = sale.items.find(
          (item) => item.productSku === `SESSION-${session.sessionNumber}`
        );

        if (sessionItem) {
          sessionItem.unitPrice = session.totalCost;
          sessionItem.subtotal = session.totalCost;
          sessionItem.finalAmount = session.finalAmount;

          sale.subtotalBeforeDiscount = sale.items.reduce(
            (acc, item) => ({
              usd: acc.usd + item.subtotal.usd,
              lbp: acc.lbp + item.subtotal.lbp,
            }),
            { usd: 0, lbp: 0 }
          );

          sale.totalItemDiscounts = sale.items.reduce(
            (acc, item) => ({
              usd: acc.usd + (item.discount?.amount.usd || 0),
              lbp: acc.lbp + (item.discount?.amount.lbp || 0),
            }),
            { usd: 0, lbp: 0 }
          );

          let totals = {
            usd: sale.subtotalBeforeDiscount.usd - sale.totalItemDiscounts.usd,
            lbp: sale.subtotalBeforeDiscount.lbp - sale.totalItemDiscounts.lbp,
          };

          if (sale.saleDiscount) {
            totals = {
              usd: totals.usd - sale.saleDiscount.amount.usd,
              lbp: totals.lbp - sale.saleDiscount.amount.lbp,
            };
          }

          sale.totals = totals;
          await sale.save();
        }
      }

      const pc = await PC.findById(session.pc);
      if (pc) {
        pc.status = PCStatus.AVAILABLE;
        await pc.save();
        socketService.lockPC(pc.pcNumber);
      }
    }

    if (session.status === SessionStatus.CANCELLED) {
      throw ApiError.badRequest("Cannot process payment for cancelled session");
    }

    if (session.paymentStatus === SessionPaymentStatus.PAID) {
      throw ApiError.badRequest("Session is already paid");
    }

    if (!session.sale) {
      throw ApiError.badRequest("Session has no associated sale");
    }

    const sale = await Sale.findById(session.sale);
    if (!sale) {
      throw ApiError.notFound("Associated sale not found");
    }

    if (sale.status === SaleStatus.PAID) {
      throw ApiError.badRequest("Sale is already paid");
    }

    if (sale.status === SaleStatus.CANCELLED) {
      throw ApiError.badRequest("Cannot pay a cancelled sale");
    }

    const totalInPaymentCurrency =
      paymentData.paymentCurrency === Currency.USD
        ? sale.totals.usd
        : sale.totals.lbp;

    if (paymentData.amount < totalInPaymentCurrency) {
      throw ApiError.badRequest("Insufficient payment amount");
    }

    sale.paymentMethod = paymentData.paymentMethod;
    sale.paymentCurrency = paymentData.paymentCurrency;

    if (paymentData.paymentCurrency === Currency.USD) {
      sale.amountPaid.usd = paymentData.amount;
      sale.amountPaid.lbp = paymentData.amount * 89500;
    } else {
      sale.amountPaid.lbp = paymentData.amount;
      sale.amountPaid.usd = paymentData.amount / 89500;
    }

    sale.status = SaleStatus.PAID;
    sale.paidAt = new Date();

    await sale.save();

    session.paymentStatus = SessionPaymentStatus.PAID;
    await session.save();

    if (sale.customer) {
      await customerService.updatePurchaseStats(
        sale.customer.toString(),
        sale.totals.usd
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

    const sale = await Sale.findById(session.sale);
    if (sale && sale.status === SaleStatus.PENDING) {
      sale.items = sale.items.filter(
        (item) => item.productSku !== `SESSION-${session.sessionNumber}`
      );

      if (sale.items.length === 0) {
        sale.status = SaleStatus.CANCELLED;
      } else {
        sale.subtotalBeforeDiscount = sale.items.reduce(
          (acc, item) => ({
            usd: acc.usd + item.subtotal.usd,
            lbp: acc.lbp + item.subtotal.lbp,
          }),
          { usd: 0, lbp: 0 }
        );

        sale.totalItemDiscounts = sale.items.reduce(
          (acc, item) => ({
            usd: acc.usd + (item.discount?.amount.usd || 0),
            lbp: acc.lbp + (item.discount?.amount.lbp || 0),
          }),
          { usd: 0, lbp: 0 }
        );

        let totals = {
          usd: sale.subtotalBeforeDiscount.usd - sale.totalItemDiscounts.usd,
          lbp: sale.subtotalBeforeDiscount.lbp - sale.totalItemDiscounts.lbp,
        };

        if (sale.saleDiscount) {
          totals = {
            usd: totals.usd - sale.saleDiscount.amount.usd,
            lbp: totals.lbp - sale.saleDiscount.amount.lbp,
          };
        }

        sale.totals = totals;
      }

      await sale.save();
    }

    const pc = await PC.findById(session.pc);
    if (pc) {
      pc.status = PCStatus.AVAILABLE;
      await pc.save();

      socketService.lockPC(pc.pcNumber);
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
