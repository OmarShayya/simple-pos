import { Types } from "mongoose";
import { ICustomer } from "../../models/customer.model";
import { IGamingSession } from "../../models/gamingsession.model";
import { IPC } from "../../models/pc.model";
import Sale, { ISale, OrderSource, SaleStatus } from "../../models/sale.model";
import { ApiError } from "../../utils/apiError";
import { createOrder } from "./orderFactory";
import { buildGamingLine, findSessionLine, productLines } from "./orderLines";
import { recalculateOrder } from "./orderPricing";

/** The order side of a gaming session: every session lives on exactly one order. */

/** Validates an existing order a new session should be added to. */
export const loadOrderForNewSession = async (saleId: string, customer: ICustomer | null): Promise<ISale> => {
  if (!Types.ObjectId.isValid(saleId)) throw ApiError.notFound("Sale not found");
  const sale = await Sale.findById(saleId);
  if (!sale) throw ApiError.notFound("Sale not found");
  if (sale.status !== SaleStatus.PENDING) throw ApiError.badRequest("Can only add gaming session to pending sales");
  if (customer && sale.customer && sale.customer.toString() !== customer._id.toString()) {
    throw ApiError.badRequest("Sale customer does not match session customer");
  }
  return sale;
};

/** Adds the session's line to `order`, or opens a new pending order (with id `orderId`) for it. */
export const attachSessionToOrder = async (params: {
  order: ISale | null;
  orderId: Types.ObjectId;
  session: IGamingSession;
  station: IPC;
  cashierId: string;
  customer: ICustomer | null;
  customerName?: string;
}): Promise<ISale> => {
  const { order, session, station, customer } = params;
  const line = buildGamingLine(session, station);
  const displayName = customer?.name ?? params.customerName;

  if (!order) {
    return createOrder({
      _id: params.orderId,
      source: OrderSource.POS,
      items: [line],
      cashier: params.cashierId,
      customer: customer?._id,
      customerName: displayName,
    });
  }

  order.items.push(line);
  if (!order.customer && customer) order.customer = customer._id;
  if (!order.customerName && displayName) order.customerName = displayName;
  recalculateOrder(order);
  await order.save();
  return order;
};

/**
 * A cancelled session comes off its (pending) order. If it was the only thing on the order,
 * the order itself is cancelled (the line stays for the record).
 */
export const detachCancelledSession = async (session: IGamingSession): Promise<void> => {
  if (!session.sale) return;
  const sale = await Sale.findById(session.sale);
  if (!sale || sale.status !== SaleStatus.PENDING) return;

  const line = findSessionLine(sale, session);
  const others = sale.items.filter((i) => i !== line);
  if (!others.length) {
    sale.status = SaleStatus.CANCELLED;
  } else {
    sale.items = others as ISale["items"];
    recalculateOrder(sale);
  }
  await sale.save();
};

/** True when the order has nothing but gaming lines. */
export const isGamingOnly = (sale: Pick<ISale, "items">) => productLines(sale.items).length === 0;
