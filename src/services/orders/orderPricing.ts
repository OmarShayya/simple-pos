import { IAmount, IAppliedDiscount } from "../../models/sale.model";
import { clampMoney, percentOf, roundMoney, subtractMoney, sumMoney, zeroMoney } from "../../utils/money";

/**
 * Pure pricing math for orders. Works on Mongoose documents and plain objects alike,
 * so the same code prices a stored order and the "live" view of a running one.
 */
export interface PricedLine {
  subtotal: IAmount;
  finalAmount: IAmount;
  discount?: IAppliedDiscount | null;
}

export interface PricedOrder {
  items: PricedLine[];
  saleDiscount?: IAppliedDiscount | null;
  subtotalBeforeDiscount: IAmount;
  totalItemDiscounts: IAmount;
  totals: IAmount;
}

/** Older rows store an empty discount shell ({ amount: 0 }) — only a percentage means a real discount. */
export const hasDiscount = (d: IAppliedDiscount | null | undefined): d is IAppliedDiscount =>
  !!d && typeof d.percentage === "number" && d.percentage > 0;

/** Re-derives a line's discount amount (from its percentage) and final amount. */
export const priceLine = (line: PricedLine): void => {
  const discount = hasDiscount(line.discount) ? percentOf(line.subtotal, line.discount.percentage) : zeroMoney();
  if (hasDiscount(line.discount)) line.discount.amount = discount;
  line.finalAmount = clampMoney(roundMoney(subtractMoney(line.subtotal, discount)));
};

/**
 * Recomputes every derived amount of an order: line discounts, subtotal, item discounts,
 * the order-level discount (always re-applied from its percentage) and the totals.
 */
export const recalculateOrder = (order: PricedOrder): void => {
  order.items.forEach(priceLine);

  const subtotal = roundMoney(sumMoney(order.items, (i) => i.subtotal));
  const itemDiscounts = roundMoney(
    sumMoney(order.items, (i) => (hasDiscount(i.discount) ? i.discount.amount : undefined))
  );
  let totals = subtractMoney(subtotal, itemDiscounts);

  if (hasDiscount(order.saleDiscount)) {
    const amount = percentOf(totals, order.saleDiscount.percentage);
    order.saleDiscount.amount = amount;
    totals = subtractMoney(totals, amount);
  }

  order.subtotalBeforeDiscount = subtotal;
  order.totalItemDiscounts = itemDiscounts;
  order.totals = clampMoney(roundMoney(totals));
};

/** Total discount given on an order (line discounts + order discount). */
export const orderDiscountTotal = (order: Pick<PricedOrder, "totalItemDiscounts" | "saleDiscount">): IAmount =>
  roundMoney({
    usd: (order.totalItemDiscounts?.usd ?? 0) + (hasDiscount(order.saleDiscount) ? order.saleDiscount.amount.usd : 0),
    lbp: (order.totalItemDiscounts?.lbp ?? 0) + (hasDiscount(order.saleDiscount) ? order.saleDiscount.amount.lbp : 0),
  });
