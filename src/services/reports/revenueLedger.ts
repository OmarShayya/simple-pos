import { Types } from "mongoose";
import GamingSession, { IGamingSession, SessionPaymentStatus, SessionStatus } from "../../models/gamingsession.model";
import { IPC, StationType } from "../../models/pc.model";
import Sale, { ISaleItem, OrderSource, SaleRecord, SaleStatus } from "../../models/sale.model";
import { Money } from "../../utils/money";
import { TimeRange } from "../../utils/period";
import { isGamingLine } from "../orders/orderLines";
import { hasDiscount, orderDiscountTotal } from "../orders/orderPricing";

/**
 * THE revenue source of truth for reports and the dashboard.
 *
 * Revenue = PAID orders, dated by when they were paid (`paidAt`). Every gaming session started
 * since the orders overhaul lives on an order, so it is counted through that order only.
 * Older sessions that were paid on their own (no order) are added as one-line entries so
 * historical numbers aren't lost — a session that has an order is never counted twice.
 *
 * Each line's revenue already includes its own discount and its share of the order discount,
 * so the lines of an entry always add up to what the customer paid.
 */
export type LineKind = "gaming" | "product";

export interface LedgerLine {
  kind: LineKind;
  revenue: Money;
  quantity: number;
  productId?: string;
  productName: string;
  stationId?: string;
  stationType?: StationType;
  durationMinutes?: number;
}

export interface LedgerEntry {
  id: string;
  /** A pre-overhaul session paid without an order */
  legacy: boolean;
  /** When the money came in */
  at: Date;
  source: OrderSource;
  /** Staff member credited with the order: who took the payment, else who created it */
  staffId?: string;
  paymentMethod: string;
  paymentCurrency?: string;
  amountPaid: Money;
  revenue: Money;
  /** Line discounts + order discount */
  discounts: Money;
  itemDiscounts: Money;
  orderDiscount: Money;
  lines: LedgerLine[];
}

const idOf = (v: unknown): string | undefined => (v ? String((v as { _id?: unknown })._id ?? v) : undefined);

/** Spreads `total` over lines in proportion to their amounts (order discount share), keeping the exact sum. */
const allocate = (amounts: number[], total: number): number[] => {
  const sum = amounts.reduce((a, b) => a + b, 0);
  if (!amounts.length) return [];
  if (sum <= 0) return amounts.map((_, i) => (i === 0 ? total : 0));
  return amounts.map((a) => (a / sum) * total);
};

const toLedgerLines = (items: ISaleItem[], totals: Money): LedgerLine[] => {
  const usd = allocate(items.map((i) => i.finalAmount?.usd ?? 0), totals.usd);
  const lbp = allocate(items.map((i) => i.finalAmount?.lbp ?? 0), totals.lbp);
  return items.map((item, index) => {
    const gaming = isGamingLine(item);
    return {
      kind: gaming ? "gaming" : "product",
      revenue: { usd: usd[index], lbp: lbp[index] },
      quantity: item.quantity ?? 1,
      productId: gaming ? undefined : idOf(item.product),
      productName: item.productName,
      stationId: gaming ? idOf(item.station?.id) : undefined,
      stationType: gaming ? item.station?.type : undefined,
      durationMinutes: gaming ? item.durationMinutes : undefined,
    };
  });
};

const orderEntry = (o: SaleRecord): LedgerEntry => ({
  id: o._id.toString(),
  legacy: false,
  at: o.paidAt ?? o.updatedAt ?? o.createdAt,
  source: o.source ?? OrderSource.POS,
  staffId: idOf(o.paidBy) ?? idOf(o.cashier),
  paymentMethod: o.paymentMethod ?? "unknown",
  paymentCurrency: o.paymentCurrency,
  amountPaid: { usd: o.amountPaid?.usd ?? 0, lbp: o.amountPaid?.lbp ?? 0 },
  revenue: { usd: o.totals.usd, lbp: o.totals.lbp },
  discounts: orderDiscountTotal(o),
  itemDiscounts: { usd: o.totalItemDiscounts?.usd ?? 0, lbp: o.totalItemDiscounts?.lbp ?? 0 },
  orderDiscount: hasDiscount(o.saleDiscount)
    ? { usd: o.saleDiscount.amount.usd, lbp: o.saleDiscount.amount.lbp }
    : { usd: 0, lbp: 0 },
  lines: toLedgerLines(o.items, o.totals),
});

const legacySessionEntry = (s: IGamingSession): LedgerEntry => {
  const amount = s.finalAmount?.usd || s.finalAmount?.lbp ? s.finalAmount : s.totalCost;
  const pc = s.pc as IPC | Types.ObjectId | undefined;
  const discount = hasDiscount(s.discount) ? { usd: s.discount.amount.usd, lbp: s.discount.amount.lbp } : { usd: 0, lbp: 0 };
  return {
    id: s._id.toString(),
    legacy: true,
    at: s.endTime ?? s.startTime,
    source: OrderSource.POS,
    staffId: idOf(s.endedBy) ?? idOf(s.startedBy),
    paymentMethod: "unknown",
    amountPaid: { usd: amount?.usd ?? 0, lbp: amount?.lbp ?? 0 },
    revenue: { usd: amount?.usd ?? 0, lbp: amount?.lbp ?? 0 },
    discounts: discount,
    itemDiscounts: discount,
    orderDiscount: { usd: 0, lbp: 0 },
    lines: [
      {
        kind: "gaming",
        revenue: { usd: amount?.usd ?? 0, lbp: amount?.lbp ?? 0 },
        quantity: 1,
        productName: `Session ${s.sessionNumber}`,
        stationId: idOf(pc),
        stationType: (pc as IPC)?.type,
        durationMinutes: s.duration,
      },
    ],
  };
};

export const loadLedger = async (range: TimeRange): Promise<LedgerEntry[]> => {
  const inRange = { $gte: range.start, $lt: range.end };
  const [orders, legacySessions] = await Promise.all([
    Sale.find({ status: SaleStatus.PAID, paidAt: inRange })
      .select("items totals saleDiscount totalItemDiscounts amountPaid paidAt source cashier paidBy paymentMethod paymentCurrency createdAt updatedAt")
      .lean<SaleRecord[]>(),
    GamingSession.find({
      sale: null,
      paymentStatus: SessionPaymentStatus.PAID,
      status: SessionStatus.COMPLETED,
      // "Quick mode" sessions were never meant to show in reports
      isBillable: { $ne: false },
      $or: [{ endTime: inRange }, { endTime: null, startTime: inRange }],
    })
      .populate("pc", "type")
      .lean<IGamingSession[]>(),
  ]);
  return [...orders.map(orderEntry), ...legacySessions.map(legacySessionEntry)];
};
