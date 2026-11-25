import GamingSession, { SessionStatus } from "../models/gamingsession.model";
import Customer from "../models/customer.model";
import PC, { IPC, PCStatus, StationType } from "../models/pc.model";
import Product, { ProductType } from "../models/product.model";
import Reservation, { IReservation, ReservationStatus } from "../models/reservation.model";
import Sale, { SaleRecord, SaleStatus } from "../models/sale.model";
import { Money, percentOf, roundMoney, roundUsd, subtractMoney } from "../utils/money";
import { TimeRange } from "../utils/period";
import { addDays, localDateString, localDayBounds, localHour } from "../utils/time";
import { getLoungeTimezone } from "./loungeSettings";
import { sessionCharge } from "./gaming/sessionClock";
import { findSessionLine, isGamingLine } from "./orders/orderLines";
import { hasDiscount } from "./orders/orderPricing";
import { toLiveOrders } from "./orders/liveOrders";
import { average, revenueTotals, topProducts } from "./reports/ledgerAggregates";
import { LedgerEntry, loadLedger } from "./reports/revenueLedger";

const UPCOMING_HOURS = 6;
const OPEN_ORDERS_LIMIT = 10;

/** Money is shown to managers/admins only (same rule as the other revenue endpoints). */
export interface OverviewViewer {
  canViewRevenue: boolean;
}

const inRange = (r: TimeRange) => ({ $gte: r.start, $lt: r.end });

const hourlyRevenue = (entries: LedgerEntry[], tz: string): number[] => {
  const hours = Array<number>(24).fill(0);
  for (const e of entries) hours[localHour(e.at, tz)] += e.revenue.usd;
  return hours.map(roundUsd);
};

const stationCounts = (stations: IPC[], type: StationType) => {
  const list = stations.filter((s) => (s.type ?? StationType.PC) === type);
  const count = (status: PCStatus) => list.filter((s) => s.status === status).length;
  return {
    total: list.length,
    available: count(PCStatus.AVAILABLE),
    occupied: count(PCStatus.OCCUPIED),
    maintenance: count(PCStatus.MAINTENANCE),
    reserved: count(PCStatus.RESERVED),
  };
};

class DashboardOverviewService {
  async getOverview(viewer: OverviewViewer) {
    const tz = await getLoungeTimezone();
    const now = new Date();
    const today = localDayBounds(localDateString(now, tz), tz);
    const yesterday = localDayBounds(addDays(localDateString(now, tz), -1), tz);
    // "Previous" = yesterday up to the same time of day
    const yesterdaySoFar: TimeRange = {
      start: yesterday.start,
      end: new Date(yesterday.start.getTime() + (now.getTime() - today.start.getTime())),
    };

    const [
      ledgerToday,
      ledgerYesterday,
      sessionsToday,
      sessionsYesterday,
      customersToday,
      customersYesterday,
      stations,
      activeSessions,
      pendingOrders,
      upcoming,
      lowStock,
    ] = await Promise.all([
      loadLedger(today),
      loadLedger(yesterday),
      GamingSession.countDocuments({ startTime: inRange(today), status: { $ne: SessionStatus.CANCELLED } }),
      GamingSession.countDocuments({ startTime: inRange(yesterdaySoFar), status: { $ne: SessionStatus.CANCELLED } }),
      Customer.countDocuments({ createdAt: inRange(today) }),
      Customer.countDocuments({ createdAt: inRange(yesterdaySoFar) }),
      PC.find({ isActive: true }).select("pcNumber name type status").lean<IPC[]>(),
      GamingSession.find({ status: SessionStatus.ACTIVE }).sort({ startTime: 1 }).populate("pc", "pcNumber name type"),
      Sale.find({ status: SaleStatus.PENDING })
        .sort({ createdAt: -1 })
        .limit(OPEN_ORDERS_LIMIT)
        .populate("customer", "name phone")
        .lean<SaleRecord[]>(),
      Reservation.find({
        status: ReservationStatus.CONFIRMED,
        startTime: { $lt: new Date(now.getTime() + UPCOMING_HOURS * 3_600_000) },
        endTime: { $gt: now },
      })
        .sort({ startTime: 1 })
        .limit(50)
        .populate("stations", "pcNumber"),
      Product.find({ isActive: true, productType: ProductType.PHYSICAL, "inventory.isLowStock": true })
        .sort({ "inventory.quantity": 1 })
        .limit(20)
        .select("name inventory")
        .lean(),
    ]);

    const t = revenueTotals(ledgerToday);
    const y = revenueTotals(ledgerYesterday.filter((e) => e.at < yesterdaySoFar.end));
    const money = (value: Money, previous: Money) =>
      viewer.canViewRevenue ? { value: value.usd, previous: previous.usd } : { value: null, previous: null };

    const todayHourly = hourlyRevenue(ledgerToday, tz);
    const yesterdayHourly = hourlyRevenue(ledgerYesterday, tz);

    // Orders of running sessions, to apply any discount set on their line
    const sessionOrders = await Sale.find({ _id: { $in: activeSessions.map((s) => s.sale).filter(Boolean) } })
      .select("items")
      .lean<SaleRecord[]>();
    const orderById = new Map(sessionOrders.map((o) => [o._id.toString(), o]));

    const openOrders = await toLiveOrders(pendingOrders, now);

    return {
      canViewRevenue: viewer.canViewRevenue,
      timezone: tz,
      generatedAt: now,
      today: {
        revenue: money(t.revenue, y.revenue),
        orders: { value: t.orders, previous: y.orders },
        avgOrder: money(average(t.revenue, t.orders), average(y.revenue, y.orders)),
        gamingRevenue: money(t.gaming, y.gaming),
        productRevenue: money(t.products, y.products),
        sessions: { value: sessionsToday, previous: sessionsYesterday },
        newCustomers: { value: customersToday, previous: customersYesterday },
      },
      hourly: viewer.canViewRevenue
        ? todayHourly.map((value, hour) => ({ hour, today: value, yesterday: yesterdayHourly[hour] }))
        : [],
      stations: {
        pc: stationCounts(stations, StationType.PC),
        playstation: stationCounts(stations, StationType.PLAYSTATION),
      },
      activeSessions: activeSessions.map((s) => {
        const pc = s.pc as IPC | null;
        const { minutes, cost } = sessionCharge(s, now);
        const order = s.sale ? orderById.get(s.sale.toString()) : undefined;
        const line = order ? findSessionLine(order, s) : undefined;
        const currentCost = hasDiscount(line?.discount)
          ? roundMoney(subtractMoney(cost, percentOf(cost, line!.discount!.percentage)))
          : cost;
        return {
          id: s._id.toString(),
          sessionNumber: s.sessionNumber,
          station: pc?.pcNumber ? { id: pc._id.toString(), pcNumber: pc.pcNumber, name: pc.name, type: pc.type ?? StationType.PC } : null,
          customerName: s.customerName ?? null,
          startTime: s.startTime,
          elapsedMinutes: minutes,
          currentCost,
          orderId: s.sale ? s.sale.toString() : null,
        };
      }),
      openOrders: openOrders.map((o) => ({
        id: o._id.toString(),
        invoiceNumber: o.invoiceNumber,
        source: o.source ?? "pos",
        customerName: o.customerName ?? (o.customer as { name?: string } | undefined)?.name ?? null,
        totals: o.totals,
        createdAt: o.createdAt,
        hasGaming: o.items.some(isGamingLine),
        hasActiveSessions: o.hasActiveSessions,
      })),
      upcomingReservations: upcoming.map((r: IReservation) => ({
        id: r._id.toString(),
        code: r.code,
        type: r.type,
        customerName: r.customerName,
        startTime: r.startTime,
        endTime: r.endTime,
        stations: (r.stations as IPC[]).map((s) => s?.pcNumber).filter(Boolean),
        status: r.status,
      })),
      lowStock: lowStock.map((p) => ({
        id: String(p._id),
        name: p.name,
        stock: p.inventory?.quantity ?? 0,
        threshold: p.inventory?.minStockLevel ?? 0,
      })),
      topProductsToday: topProducts(ledgerToday, 5).map((p) => ({
        name: p.name,
        quantity: p.quantity,
        revenue: viewer.canViewRevenue ? p.revenue : null,
      })),
    };
  }
}

export default new DashboardOverviewService();
