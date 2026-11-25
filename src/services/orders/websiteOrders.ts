import { CustomerSource } from "../../models/customer.model";
import { OrderSource } from "../../models/sale.model";
import logger from "../../utils/logger";
import customerService from "../customer.service";
import socketService from "../socket.service";
import { createOrder } from "./orderFactory";
import { buildMenuProductLines, moveStock } from "./orderLines";

export interface WebsiteOrderInput {
  items: Array<{ productId: string; quantity: number }>;
  customerName: string;
  customerPhone: string;
  phoneCountry?: string;
  notes?: string;
}

/** Socket event the POS listens to for new website orders. */
export const ORDER_NEW_EVENT = "order:new";

/**
 * Order placed from the website menu: prices come from the database, the customer is linked
 * (or created) by phone, the order waits as "pending" at the counter and the POS is notified.
 */
export const placeWebsiteOrder = async (input: WebsiteOrderInput) => {
  const items = await buildMenuProductLines(input.items);
  const customer = await customerService.findOrCreateByPhone(
    { name: input.customerName, phone: input.customerPhone, phoneCountry: input.phoneCountry },
    { source: CustomerSource.WEBSITE }
  );

  const order = await createOrder({
    source: OrderSource.WEBSITE,
    items,
    customer: customer._id,
    customerName: input.customerName.trim(),
    notes: input.notes?.trim() || undefined,
  });
  await moveStock(order.items, -1);

  socketService.emitToStaff(ORDER_NEW_EVENT, {
    id: order._id.toString(),
    invoiceNumber: order.invoiceNumber,
    source: order.source,
    customerName: order.customerName,
    totals: order.totals,
    itemCount: order.items.reduce((n, i) => n + i.quantity, 0),
    createdAt: order.createdAt,
  });
  logger.info(`[ORDER] Website order ${order.invoiceNumber} ($${order.totals.usd}) from ${customer.phone}`);

  return {
    invoiceNumber: order.invoiceNumber,
    status: order.status,
    totals: order.totals,
    items: order.items.map((i) => ({
      productId: i.product?.toString(),
      productName: i.productName,
      quantity: i.quantity,
      unitPrice: i.unitPrice,
      subtotal: i.subtotal,
      finalAmount: i.finalAmount,
    })),
    createdAt: order.createdAt,
  };
};
