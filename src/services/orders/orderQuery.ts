import { FilterQuery, Types } from "mongoose";
import { ISale, OrderSource, SaleItemKind, SaleStatus } from "../../models/sale.model";
import { localDateRange } from "../../utils/period";
import customerService from "../customer.service";

export type OrderTypeFilter = "gaming" | "products" | "mixed";

export interface OrderListFilters {
  status?: SaleStatus[];
  source?: OrderSource;
  type?: OrderTypeFilter;
  search?: string;
  /** Lounge-local YYYY-MM-DD, inclusive */
  from?: string;
  to?: string;
  customerId?: string;
  cashierId?: string;
}

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Line kinds of an order. Every line is tagged (`kind`) by the startup migration,
 * so "no line is gaming" ⇔ products only, etc.
 */
const typeFilter = (type: OrderTypeFilter): FilterQuery<ISale> => {
  switch (type) {
    case "gaming":
      return { "items.kind": { $eq: SaleItemKind.GAMING, $ne: SaleItemKind.PRODUCT } };
    case "products":
      return { "items.kind": { $ne: SaleItemKind.GAMING } };
    case "mixed":
      return { $and: [{ "items.kind": SaleItemKind.GAMING }, { "items.kind": SaleItemKind.PRODUCT }] };
  }
};

/** Mongo filter for the orders list. Dates are interpreted in the lounge timezone. */
export const buildOrderFilter = async (f: OrderListFilters, tz: string): Promise<FilterQuery<ISale>> => {
  const and: FilterQuery<ISale>[] = [];

  if (f.status?.length) and.push({ status: { $in: f.status } });
  if (f.source === OrderSource.POS) and.push({ source: { $in: [OrderSource.POS, null] } });
  else if (f.source) and.push({ source: f.source });
  if (f.type) and.push(typeFilter(f.type));
  if (f.customerId) and.push({ customer: new Types.ObjectId(f.customerId) });
  if (f.cashierId) and.push({ cashier: new Types.ObjectId(f.cashierId) });

  const { start, end } = localDateRange(tz, f.from, f.to);
  if (start || end) {
    and.push({ createdAt: { ...(start ? { $gte: start } : {}), ...(end ? { $lt: end } : {}) } });
  }

  const term = f.search?.trim();
  if (term) {
    const pattern = { $regex: escapeRegex(term), $options: "i" };
    const customerIds = await customerService.searchIds(term);
    and.push({
      $or: [{ invoiceNumber: pattern }, { customerName: pattern }, ...(customerIds.length ? [{ customer: { $in: customerIds } }] : [])],
    });
  }

  return and.length ? { $and: and } : {};
};
