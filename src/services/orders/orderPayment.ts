import { Types } from "mongoose";
import config from "../../config/config";
import GamingSession, { SessionPaymentStatus, SessionStatus } from "../../models/gamingsession.model";
import Sale, { Currency, ISale, PaymentMethod, SaleStatus } from "../../models/sale.model";
import { ApiError } from "../../utils/apiError";
import { roundUsd } from "../../utils/money";
import customerService from "../customer.service";
import { releaseStation, settleSessionOnOrder, stopSessionClock } from "../gaming/sessionLifecycle";

export interface PaymentInput {
  paymentMethod: PaymentMethod;
  paymentCurrency: Currency;
  amount: number;
}

/**
 * Payment always happens on the order. Running sessions on the order are stopped and billed first,
 * then the amount is checked — nothing is changed if the payment is short.
 * The order's sessions mirror its payment status.
 */
export const payOrder = async (orderId: string, payment: PaymentInput, paidBy?: string): Promise<ISale> => {
  if (!Types.ObjectId.isValid(orderId)) throw ApiError.notFound("Sale not found");
  const sale = await Sale.findById(orderId);
  if (!sale) throw ApiError.notFound("Sale not found");
  if (sale.status === SaleStatus.PAID) throw ApiError.badRequest("Sale is already paid");
  if (sale.status === SaleStatus.CANCELLED) throw ApiError.badRequest("Cannot pay a cancelled sale");

  const now = new Date();
  const running = await GamingSession.find({ sale: sale._id, status: SessionStatus.ACTIVE }).populate("pc");
  for (const session of running) {
    stopSessionClock(session, now, paidBy);
    settleSessionOnOrder(sale, session);
  }

  const due = payment.paymentCurrency === Currency.USD ? sale.totals.usd : sale.totals.lbp;
  if (payment.amount < due) throw ApiError.badRequest("Insufficient payment amount");

  const rate = config.currency.exchangeRate;
  sale.paymentMethod = payment.paymentMethod;
  sale.paymentCurrency = payment.paymentCurrency;
  sale.amountPaid =
    payment.paymentCurrency === Currency.USD
      ? { usd: payment.amount, lbp: Math.round(payment.amount * rate) }
      : { usd: roundUsd(payment.amount / rate), lbp: payment.amount };
  sale.status = SaleStatus.PAID;
  sale.paidAt = now;
  if (paidBy) sale.paidBy = new Types.ObjectId(paidBy);
  await sale.save();

  for (const session of running) {
    await session.save();
    await releaseStation(session.pc);
  }
  await GamingSession.updateMany(
    { sale: sale._id, status: { $ne: SessionStatus.CANCELLED } },
    { paymentStatus: SessionPaymentStatus.PAID }
  );

  if (sale.customer) await customerService.updatePurchaseStats(sale.customer.toString(), sale.totals.usd);
  return sale;
};
