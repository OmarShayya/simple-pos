import { Types } from "mongoose";
import { IGamingSession } from "../models/gamingsession.model";
import { IPC, StationType } from "../models/pc.model";
import { IAppliedDiscount } from "../models/sale.model";
import { hasDiscount, orderDiscountTotal } from "../services/orders/orderPricing";
import { isGamingLine } from "../services/orders/orderLines";
import { LiveLine, LiveOrder, OrderSessions } from "../services/orders/liveOrders";
import { toCustomerSummary } from "./customer.presenter";

/** API shapes of orders (= sales). Inputs are live views, so running sessions show their current cost. */

interface PopulatedUser {
  _id: Types.ObjectId;
  name: string;
  email?: string;
}

const isPopulated = <T extends object>(value: unknown, key: keyof T): value is T =>
  !!value && typeof value === "object" && key in (value as object);

const idOf = (value: unknown): string | null => {
  if (!value) return null;
  if (isPopulated<{ _id: Types.ObjectId }>(value, "_id")) return value._id.toString();
  return String(value);
};

const toUser = (value: unknown, withEmail = false) =>
  isPopulated<PopulatedUser>(value, "name")
    ? { id: value._id.toString(), name: value.name, ...(withEmail ? { email: value.email } : {}) }
    : null;

const toDiscount = (d: IAppliedDiscount | null | undefined) =>
  hasDiscount(d)
    ? { discountId: d.discountId?.toString(), discountName: d.discountName, percentage: d.percentage, amount: d.amount }
    : undefined;

export const toOrderLine = (item: LiveLine, session?: IGamingSession) => {
  const gaming = isGamingLine(item);
  const productId = gaming ? null : idOf(item.product);
  const pc = session?.pc as IPC | undefined;
  return {
    kind: gaming ? "gaming" : "product",
    product: productId,
    productId,
    productName: item.productName,
    productSku: item.productSku,
    quantity: item.quantity,
    unitPrice: item.unitPrice,
    discount: toDiscount(item.discount),
    subtotal: item.subtotal,
    finalAmount: item.finalAmount,
    ...(gaming
      ? {
          gamingSession: idOf(item.gamingSession) ?? (session ? session._id.toString() : null),
          station: item.station
            ? { id: idOf(item.station.id), pcNumber: item.station.pcNumber, name: item.station.name, type: item.station.type }
            : pc?.pcNumber
              ? { id: pc._id.toString(), pcNumber: pc.pcNumber, name: pc.name, type: pc.type ?? StationType.PC }
              : null,
          durationMinutes: item.durationMinutes ?? session?.duration ?? 0,
          isActive: !!item.isActive,
          // Kept for older POS builds
          sessionData: session
            ? {
                sessionId: session._id.toString(),
                sessionNumber: session.sessionNumber,
                pcNumber: pc?.pcNumber ?? item.station?.pcNumber,
                pcName: pc?.name ?? item.station?.name,
                hourlyRate: session.hourlyRate,
                startTime: session.startTime,
                endTime: session.endTime,
                status: session.status,
              }
            : undefined,
        }
      : {}),
  };
};

const itemCount = (order: LiveOrder) => order.items.reduce((n, i) => n + (i.quantity || 0), 0);

/** Row of the orders list (also used for customer activity). */
export const toOrderRow = (order: LiveOrder) => {
  const customer = toCustomerSummary(order.customer);
  return {
    id: order._id.toString(),
    invoiceNumber: order.invoiceNumber,
    source: order.source ?? "pos",
    status: order.status,
    customer,
    customerName: order.customerName ?? customer?.name ?? null,
    cashier: toUser(order.cashier),
    paidBy: toUser(order.paidBy),
    hasGaming: order.items.some(isGamingLine),
    hasActiveSessions: order.hasActiveSessions,
    itemCount: itemCount(order),
    subtotalBeforeDiscount: order.subtotalBeforeDiscount,
    totalItemDiscounts: order.totalItemDiscounts,
    saleDiscount: toDiscount(order.saleDiscount),
    discountTotal: orderDiscountTotal(order),
    totals: order.totals,
    /** Same as `totals` (live); kept for older POS builds */
    currentTotals: order.totals,
    paymentMethod: order.paymentMethod,
    paymentCurrency: order.paymentCurrency,
    createdAt: order.createdAt,
    paidAt: order.paidAt,
  };
};

/** Full order for the order screen / invoice / receipt. */
export const toOrderDetail = (order: LiveOrder, sessions: OrderSessions) => ({
  ...toOrderRow(order),
  cashier: toUser(order.cashier, true),
  items: order.items.map((item) => toOrderLine(item, isGamingLine(item) ? sessions.forLine(item) : undefined)),
  activeSessions: order.activeSessions,
  amountPaid: order.amountPaid,
  notes: order.notes,
  updatedAt: order.updatedAt,
});
