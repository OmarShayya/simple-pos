import { Types } from "mongoose";
import GamingSession, { IGamingSession, SessionStatus } from "../../models/gamingsession.model";
import { IPC } from "../../models/pc.model";
import { IAppliedDiscount, ISaleItem, SaleRecord, SaleStatus } from "../../models/sale.model";
import { Money } from "../../utils/money";
import { gamingLineName, sessionCharge } from "../gaming/sessionClock";
import { isGamingLine, SESSION_SKU_PREFIX } from "./orderLines";
import { recalculateOrder } from "./orderPricing";

/**
 * "Live" view of orders: a running session's line shows what it costs right now,
 * and the order totals include it (discounts applied). Nothing is persisted.
 */
export interface LiveLine extends ISaleItem {
  /** The line's session is still running */
  isActive?: boolean;
}

export interface LiveOrder extends Omit<SaleRecord, "items"> {
  items: LiveLine[];
  hasActiveSessions: boolean;
  activeSessions: Array<{ sessionId: string; sessionNumber: string; currentDuration: number; currentCost: Money }>;
}

/** Sessions of a set of orders, indexed by id and by session number (legacy lines only have the SKU). */
export class OrderSessions {
  private byId = new Map<string, IGamingSession>();
  private byNumber = new Map<string, IGamingSession>();

  constructor(sessions: IGamingSession[]) {
    for (const s of sessions) {
      this.byId.set(s._id.toString(), s);
      this.byNumber.set(s.sessionNumber, s);
    }
  }

  static async load(orderIds: Types.ObjectId[], opts: { activeOnly?: boolean } = {}): Promise<OrderSessions> {
    if (!orderIds.length) return new OrderSessions([]);
    const sessions = await GamingSession.find({
      sale: { $in: orderIds },
      ...(opts.activeOnly ? { status: SessionStatus.ACTIVE } : {}),
    }).populate("pc", "pcNumber name type");
    return new OrderSessions(sessions);
  }

  forLine(line: Pick<ISaleItem, "gamingSession" | "productSku">): IGamingSession | undefined {
    if (line.gamingSession) {
      const hit = this.byId.get(line.gamingSession.toString());
      if (hit) return hit;
    }
    if (line.productSku?.startsWith(SESSION_SKU_PREFIX)) {
      return this.byNumber.get(line.productSku.slice(SESSION_SKU_PREFIX.length));
    }
    return undefined;
  }
}

const copyMoney = (m: Money | undefined): Money => ({ usd: m?.usd ?? 0, lbp: m?.lbp ?? 0 });
const copyDiscount = (d: IAppliedDiscount | undefined): IAppliedDiscount | undefined =>
  d ? { discountId: d.discountId, discountName: d.discountName, percentage: d.percentage, amount: copyMoney(d.amount) } : undefined;

const copyLine = (item: ISaleItem): LiveLine => ({
  ...item,
  unitPrice: copyMoney(item.unitPrice),
  subtotal: copyMoney(item.subtotal),
  finalAmount: copyMoney(item.finalAmount),
  discount: copyDiscount(item.discount),
});

export const toLiveOrder = (order: SaleRecord, sessions: OrderSessions, now: Date = new Date()): LiveOrder => {
  const items = order.items.map(copyLine);
  const live: LiveOrder = {
    ...order,
    items,
    subtotalBeforeDiscount: copyMoney(order.subtotalBeforeDiscount),
    totalItemDiscounts: copyMoney(order.totalItemDiscounts),
    totals: copyMoney(order.totals),
    saleDiscount: copyDiscount(order.saleDiscount),
    hasActiveSessions: false,
    activeSessions: [],
  };

  for (const line of items) {
    if (!isGamingLine(line)) continue;
    const session = sessions.forLine(line);
    if (!session || session.status !== SessionStatus.ACTIVE) continue;

    const { minutes, cost } = sessionCharge(session, now);
    line.isActive = true;
    line.durationMinutes = minutes;
    line.unitPrice = { ...cost };
    line.subtotal = { ...cost };
    const pcNumber = line.station?.pcNumber ?? (session.pc as IPC)?.pcNumber;
    if (pcNumber) line.productName = gamingLineName(pcNumber, minutes);
    live.hasActiveSessions = true;
    live.activeSessions.push({
      sessionId: session._id.toString(),
      sessionNumber: session.sessionNumber,
      currentDuration: minutes,
      currentCost: cost,
    });
  }

  if (live.hasActiveSessions) recalculateOrder(live);
  return live;
};

/** Live views for a list of plain orders (one query for all their running sessions). */
export const toLiveOrders = async (orders: SaleRecord[], now: Date = new Date()): Promise<LiveOrder[]> => {
  const withGaming = orders.filter((o) => o.status === SaleStatus.PENDING && o.items.some(isGamingLine)).map((o) => o._id);
  const sessions = await OrderSessions.load(withGaming, { activeOnly: true });
  return orders.map((o) => toLiveOrder(o, sessions, now));
};
