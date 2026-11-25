import { Types } from "mongoose";
import { IGamingSession, SessionStatus } from "../../models/gamingsession.model";
import PC, { IPC, PCStatus } from "../../models/pc.model";
import { IAppliedDiscount, ISale } from "../../models/sale.model";
import logger from "../../utils/logger";
import socketService from "../socket.service";
import { buildGamingLine, chargeGamingLine, findSessionLine } from "../orders/orderLines";
import { hasDiscount, recalculateOrder } from "../orders/orderPricing";
import { sessionCharge } from "./sessionClock";

/**
 * Building blocks shared by every path that ends a session (end, pay, cancel, PC unlock),
 * so the station, the session and its order line always agree.
 */

const pcIdOf = (pc: IGamingSession["pc"]): Types.ObjectId => (pc as IPC)?._id ?? pc;

/** Stops the clock: final duration and cost (does not save). */
export const stopSessionClock = (session: IGamingSession, at: Date = new Date(), endedBy?: string): void => {
  const { minutes, cost } = sessionCharge({ startTime: session.startTime, endTime: at, hourlyRate: session.hourlyRate });
  session.endTime = at;
  session.duration = minutes;
  session.totalCost = cost;
  session.finalAmount = { ...cost };
  session.status = SessionStatus.COMPLETED;
  if (endedBy) session.endedBy = new Types.ObjectId(endedBy);
};

/** Frees the station and locks the physical PC. */
export const releaseStation = async (pcRef: IGamingSession["pc"]): Promise<void> => {
  const pc = await PC.findById(pcIdOf(pcRef));
  if (!pc) return;
  if (pc.status === PCStatus.OCCUPIED || pc.status === PCStatus.RESERVED) {
    pc.status = PCStatus.AVAILABLE;
    await pc.save();
  }
  const locked = socketService.lockPC(pc.pcNumber);
  logger.info(`[GAMING SESSION] ${pc.pcNumber} released (lock sent: ${locked ? "yes" : "no — PC agent offline"})`);
};

/**
 * Writes a stopped session onto its order line (duration, price, optional discount),
 * recomputes the order totals and mirrors the line's final amount back onto the session.
 * Neither document is saved here.
 */
export const settleSessionOnOrder = (order: ISale, session: IGamingSession, discount?: IAppliedDiscount): void => {
  let line = findSessionLine(order, session);
  if (!line && (session.pc as IPC)?.pcNumber) {
    order.items.push(buildGamingLine(session, session.pc as IPC));
    line = findSessionLine(order, session);
  }
  if (!line) return;

  chargeGamingLine(line, session.duration ?? 0, session.totalCost, (session.pc as IPC)?.pcNumber);
  line.gamingSession = session._id;
  if (discount) line.discount = discount;
  recalculateOrder(order);

  session.discount = hasDiscount(line.discount)
    ? {
        discountId: line.discount.discountId,
        discountName: line.discount.discountName,
        percentage: line.discount.percentage,
        amount: { usd: line.discount.amount.usd, lbp: line.discount.amount.lbp },
      }
    : undefined;
  session.finalAmount = { usd: line.finalAmount.usd, lbp: line.finalAmount.lbp };
};
