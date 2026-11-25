import { Types } from "mongoose";
import Sale, { ISale, ISaleItem, OrderSource, SaleRecord, SaleStatus } from "../models/sale.model";
import GamingSession, { SessionStatus } from "../models/gamingsession.model";
import customerService from "./customer.service";
import { ApiError } from "../utils/apiError";
import { localDateRange } from "../utils/period";
import { localDateString } from "../utils/time";
import { getLoungeTimezone } from "./loungeSettings";
import { releaseStation } from "./gaming/sessionLifecycle";
import { resolveDiscount } from "./orders/discountRules";
import { createOrder } from "./orders/orderFactory";
import {
  buildStaffProductLines,
  gamingLines,
  isGamingLine,
  moveStock,
  ProductLineInput,
  productLines,
} from "./orders/orderLines";
import { payOrder, PaymentInput } from "./orders/orderPayment";
import { orderDiscountTotal, recalculateOrder } from "./orders/orderPricing";
import { buildOrderFilter, OrderListFilters } from "./orders/orderQuery";
import { LiveOrder, OrderSessions, toLiveOrder, toLiveOrders } from "./orders/liveOrders";
import { sumMoney, roundMoney } from "../utils/money";

export interface SessionDiscountInput {
  productSku?: string;
  gamingSessionId?: string;
  discountId?: string;
}

export interface UpdateOrderInput {
  customerId?: string;
  items?: ProductLineInput[];
  sessionDiscounts?: SessionDiscountInput[];
  saleDiscountId?: string;
  notes?: string;
}

const LIST_POPULATE = [
  { path: "customer", select: "name phone" },
  { path: "cashier", select: "name" },
  { path: "paidBy", select: "name" },
];

const DETAIL_POPULATE = [
  { path: "customer", select: "name phone email phoneCountry" },
  { path: "cashier", select: "name email" },
  { path: "paidBy", select: "name" },
];

class SaleService {
  private async getOrderDoc(id: string): Promise<ISale> {
    const sale = Types.ObjectId.isValid(id) ? await Sale.findById(id) : null;
    if (!sale) throw ApiError.notFound("Sale not found");
    return sale;
  }

  async createSale(
    cashierId: string,
    data: { customerId?: string; items: ProductLineInput[]; saleDiscountId?: string; notes?: string }
  ): Promise<ISale> {
    const customer = data.customerId ? await customerService.getCustomerById(data.customerId) : null;
    const items = await buildStaffProductLines(data.items);
    const saleDiscount = data.saleDiscountId ? await resolveDiscount(data.saleDiscountId, { on: "order" }) : undefined;

    const sale = await createOrder({
      source: OrderSource.POS,
      items,
      cashier: cashierId,
      customer: customer?._id,
      customerName: customer?.name,
      saleDiscount,
      notes: data.notes,
    });
    await moveStock(sale.items, -1);
    return sale.populate(["customer", "cashier"]);
  }

  /** Edits a pending order. Gaming lines are kept; `items` replaces the product lines. */
  async updateSale(saleId: string, data: UpdateOrderInput): Promise<ISale> {
    const sale = await this.getOrderDoc(saleId);
    if (sale.status !== SaleStatus.PENDING) throw ApiError.badRequest("Can only update pending sales");

    if (data.customerId !== undefined) {
      const customer = data.customerId ? await customerService.getCustomerById(data.customerId) : null;
      sale.customer = customer?._id;
      if (customer) sale.customerName = customer.name;
    }

    if (data.items !== undefined) {
      const kept = gamingLines(sale.items);
      const previous = productLines(sale.items);
      await moveStock(previous, 1);
      let lines: ISaleItem[];
      try {
        lines = data.items.length ? await buildStaffProductLines(data.items) : [];
      } catch (error) {
        await moveStock(previous, -1); // leave stock as it was
        throw error;
      }
      await moveStock(lines, -1);
      sale.items = [...kept, ...lines] as ISale["items"];
    }

    for (const sd of data.sessionDiscounts ?? []) {
      const line = sale.items.find(
        (i) =>
          (sd.gamingSessionId && i.gamingSession?.toString() === sd.gamingSessionId) ||
          (sd.productSku && i.productSku === sd.productSku)
      );
      if (!line) throw ApiError.notFound(`Session item ${sd.productSku ?? sd.gamingSessionId} not found`);
      if (!isGamingLine(line)) {
        throw ApiError.badRequest(`Item ${sd.productSku} is not a gaming session`);
      }
      line.discount = sd.discountId ? await resolveDiscount(sd.discountId, { on: "gaming" }) : undefined;
    }

    if (data.saleDiscountId !== undefined) {
      sale.saleDiscount = data.saleDiscountId ? await resolveDiscount(data.saleDiscountId, { on: "order" }) : undefined;
    }
    if (data.notes !== undefined) sale.notes = data.notes;

    if (!sale.items.length) throw ApiError.badRequest("An order needs at least one item");
    recalculateOrder(sale);
    await sale.save();
    return sale.populate(["customer", "cashier"]);
  }

  async paySale(saleId: string, payment: PaymentInput, userId?: string): Promise<ISale> {
    return payOrder(saleId, payment, userId);
  }

  /** Full order (live cost for running sessions) for the order screen and receipts. */
  async getOrderDetail(id: string): Promise<{ order: LiveOrder; sessions: OrderSessions }> {
    if (!Types.ObjectId.isValid(id)) throw ApiError.notFound("Sale not found");
    const record = await Sale.findById(id).populate(DETAIL_POPULATE).lean<SaleRecord>();
    if (!record) throw ApiError.notFound("Sale not found");
    return this.withSessions(record);
  }

  async getOrderDetailByInvoice(invoiceNumber: string): Promise<{ order: LiveOrder; sessions: OrderSessions }> {
    const record = await Sale.findOne({ invoiceNumber }).populate(DETAIL_POPULATE).lean<SaleRecord>();
    if (!record) throw ApiError.notFound("Sale not found");
    return this.withSessions(record);
  }

  private async withSessions(record: SaleRecord) {
    const sessions = await OrderSessions.load(gamingLines(record.items).length ? [record._id] : []);
    return { order: toLiveOrder(record, sessions), sessions };
  }

  async listOrders(
    filters: OrderListFilters,
    page = 1,
    limit = 20
  ): Promise<{ orders: LiveOrder[]; total: number; page: number; totalPages: number }> {
    const tz = await getLoungeTimezone();
    const query = await buildOrderFilter(filters, tz);
    const [records, total] = await Promise.all([
      Sale.find(query)
        .populate(LIST_POPULATE)
        .sort({ createdAt: -1, _id: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean<SaleRecord[]>(),
      Sale.countDocuments(query),
    ]);
    return { orders: await toLiveOrders(records), total, page, totalPages: Math.ceil(total / limit) };
  }

  /** Sidebar badges. */
  async getCounts(): Promise<{ open: number; websiteOpen: number }> {
    const [open, websiteOpen] = await Promise.all([
      Sale.countDocuments({ status: SaleStatus.PENDING }),
      Sale.countDocuments({ status: SaleStatus.PENDING, source: OrderSource.WEBSITE }),
    ]);
    return { open, websiteOpen };
  }

  async cancelSale(saleId: string, userId?: string): Promise<ISale> {
    const sale = await this.getOrderDoc(saleId);
    if (sale.status === SaleStatus.PAID) throw ApiError.badRequest("Cannot cancel a paid sale");
    if (sale.status === SaleStatus.CANCELLED) throw ApiError.badRequest("Sale is already cancelled");

    const running = await GamingSession.find({ sale: sale._id, status: SessionStatus.ACTIVE });
    for (const session of running) {
      session.status = SessionStatus.CANCELLED;
      session.endTime = new Date();
      if (userId) session.endedBy = new Types.ObjectId(userId);
      await session.save();
      await releaseStation(session.pc);
    }

    await moveStock(sale.items, 1);
    sale.status = SaleStatus.CANCELLED;
    await sale.save();
    return sale.populate(["customer", "cashier"]);
  }

  /** Today's orders (lounge-local day). */
  async getTodaySales() {
    const tz = await getLoungeTimezone();
    const today = localDateString(new Date(), tz);
    const { start, end } = localDateRange(tz, today, today);

    const records = await Sale.find({ createdAt: { $gte: start, $lt: end }, status: { $ne: SaleStatus.CANCELLED } })
      .populate(LIST_POPULATE)
      .sort({ createdAt: -1 })
      .lean<SaleRecord[]>();
    const orders = await toLiveOrders(records);
    const paid = orders.filter((o) => o.status === SaleStatus.PAID);

    return {
      totalSales: orders.length,
      totalRevenue: roundMoney(sumMoney(paid, (o) => o.totals)),
      totalDiscounts: roundMoney(sumMoney(orders, (o) => orderDiscountTotal(o))),
      pendingSales: orders.filter((o) => o.status === SaleStatus.PENDING).length,
      paidSales: paid.length,
      orders,
    };
  }
}

export default new SaleService();
