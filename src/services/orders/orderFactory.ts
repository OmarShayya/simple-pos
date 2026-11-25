import { Types } from "mongoose";
import Sale, { ISale, ISaleItem, OrderSource, SaleStatus, IAppliedDiscount } from "../../models/sale.model";
import { zeroMoney } from "../../utils/money";
import { createWithDailyCode } from "../numbering";
import { recalculateOrder } from "./orderPricing";

export interface NewOrder {
  _id?: Types.ObjectId;
  source: OrderSource;
  items: ISaleItem[];
  cashier?: string | Types.ObjectId;
  customer?: Types.ObjectId;
  customerName?: string;
  saleDiscount?: IAppliedDiscount;
  notes?: string;
}

/** Creates a pending order with the next invoice number of the (lounge-local) day and priced totals. */
export const createOrder = async (input: NewOrder): Promise<ISale> => {
  const priced = {
    ...input,
    status: SaleStatus.PENDING,
    subtotalBeforeDiscount: zeroMoney(),
    totalItemDiscounts: zeroMoney(),
    totals: zeroMoney(),
  };
  recalculateOrder(priced);

  return createWithDailyCode({
    lastCode: async (pattern) => {
      const last = await Sale.findOne({ invoiceNumber: pattern })
        .sort({ invoiceNumber: -1 })
        .select("invoiceNumber")
        .lean<{ invoiceNumber: string }>();
      return last?.invoiceNumber ?? null;
    },
    create: (invoiceNumber) => Sale.create({ ...priced, invoiceNumber }),
  });
};
