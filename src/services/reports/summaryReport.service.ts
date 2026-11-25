import { Types } from "mongoose";
import Category from "../../models/category.model";
import Customer from "../../models/customer.model";
import PC, { StationType } from "../../models/pc.model";
import Product from "../../models/product.model";
import Reservation, { ReservationStatus } from "../../models/reservation.model";
import { IDaySchedule } from "../../models/reservationSettings.model";
import Sale, { OrderSource, SaleStatus } from "../../models/sale.model";
import User from "../../models/user.model";
import { openWindowsInRange } from "../../utils/businessHours";
import { Money, roundUsd } from "../../utils/money";
import { LabeledRange, ReportPeriod, resolvePeriod, TimeRange } from "../../utils/period";
import { localDateString } from "../../utils/time";
import { getLoungeHours } from "../loungeSettings";
import {
  average,
  busiestHours,
  byCategory,
  byPaymentMethod,
  byStaff,
  gamingRevenueByStation,
  revenueSeries,
  revenueTotals,
  RevenueTotals,
  topProducts,
} from "./ledgerAggregates";
import { LedgerEntry, loadLedger } from "./revenueLedger";
import { loadSessionsOverlapping, StationUsage, totalMs, usageByStation, usageTotals } from "./stationUsage";

type PeriodRange = LabeledRange & { firstDay: string; lastDay: string };

interface PeriodData {
  ledger: LedgerEntry[];
  totals: RevenueTotals;
  usage: Map<string, StationUsage>;
  openMs: number;
  gamingHours: number;
  sessions: number;
  newCustomers: number;
  websiteOrders: number;
  reservations: number;
  noShows: number;
}

const moneyKpi = (value: Money, previous: Money) => ({
  value: value.usd,
  previous: previous.usd,
  lbp: { value: value.lbp, previous: previous.lbp },
});
const countKpi = (value: number, previous: number) => ({ value, previous });
const round2 = (n: number) => Math.round(n * 100) / 100;
const round3 = (n: number) => Math.round(n * 1000) / 1000;
const rangeOut = (r: LabeledRange) => ({ start: r.start, end: r.end, label: r.label });

const inRange = (r: TimeRange) => ({ $gte: r.start, $lt: r.end });

class SummaryReportService {
  /** Everything one period needs, loaded in parallel. */
  private async loadPeriod(range: PeriodRange, schedule: IDaySchedule[], tz: string): Promise<PeriodData> {
    const [ledger, sessions, newCustomers, websiteOrders, reservations, noShows] = await Promise.all([
      loadLedger(range),
      loadSessionsOverlapping(range),
      Customer.countDocuments({ createdAt: inRange(range) }),
      Sale.countDocuments({ source: OrderSource.WEBSITE, createdAt: inRange(range), status: { $ne: SaleStatus.CANCELLED } }),
      Reservation.countDocuments({ startTime: inRange(range), status: { $ne: ReservationStatus.CANCELLED } }),
      Reservation.countDocuments({ startTime: inRange(range), status: ReservationStatus.NO_SHOW }),
    ]);
    const openWindows = openWindowsInRange(schedule, tz, range);
    const usage = usageByStation(sessions, range, openWindows);
    const totals = usageTotals(usage);
    return {
      ledger,
      totals: revenueTotals(ledger),
      usage,
      openMs: totalMs(openWindows),
      gamingHours: totals.hours,
      sessions: totals.sessions,
      newCustomers,
      websiteOrders,
      reservations,
      noShows,
    };
  }

  private async categoryLookup(ledger: LedgerEntry[]) {
    const productIds = [
      ...new Set(ledger.flatMap((e) => e.lines.map((l) => l.productId)).filter((id): id is string => !!id && Types.ObjectId.isValid(id))),
    ];
    const products = await Product.find({ _id: { $in: productIds } }).select("category").lean();
    const categories = await Category.find({ _id: { $in: products.map((p) => p.category) } }).select("name").lean();
    const categoryName = new Map(categories.map((c) => [String(c._id), c.name]));
    const categoryOfProduct = new Map(products.map((p) => [String(p._id), categoryName.get(String(p.category))]));
    return (productId?: string) => (productId && categoryOfProduct.get(productId)) || "Uncategorized";
  }

  private async staffLookup(ledger: LedgerEntry[]) {
    const ids = [...new Set(ledger.map((e) => e.staffId).filter((id): id is string => !!id && Types.ObjectId.isValid(id)))];
    const users = await User.find({ _id: { $in: ids } }).select("name").lean();
    const names = new Map(users.map((u) => [String(u._id), u.name]));
    return (id: string) => names.get(id);
  }

  private async stationRows(data: PeriodData) {
    const revenue = gamingRevenueByStation(data.ledger);
    const stations = await PC.find({}).select("pcNumber name type isActive").sort({ type: 1, pcNumber: 1 }).lean();
    return stations
      .filter((s) => s.isActive || data.usage.has(String(s._id)) || revenue.has(String(s._id)))
      .map((s) => {
        const id = String(s._id);
        const usage = data.usage.get(id);
        return {
          id,
          pcNumber: s.pcNumber,
          name: s.name,
          type: s.type ?? StationType.PC,
          sessions: usage?.sessions ?? 0,
          hours: round2((usage?.occupiedMs ?? 0) / 3_600_000),
          revenue: roundUsd(revenue.get(id) ?? 0),
          /** 0–1; null when the lounge was closed for the whole range */
          utilization: data.openMs > 0 ? round3((usage?.openOccupiedMs ?? 0) / data.openMs) : null,
        };
      });
  }

  async getSummary(period: ReportPeriod, date?: string) {
    const { timezone, schedule } = await getLoungeHours();
    const resolved = resolvePeriod(period, date ?? localDateString(new Date(), timezone), timezone);

    const [current, previous] = await Promise.all([
      this.loadPeriod(resolved.range, schedule, timezone),
      this.loadPeriod(resolved.previous, schedule, timezone),
    ]);
    const [categoryOf, staffName, stations] = await Promise.all([
      this.categoryLookup(current.ledger),
      this.staffLookup(current.ledger),
      this.stationRows(current),
    ]);

    const byType = (type: StationType) => {
      const rows = stations.filter((s) => s.type === type);
      return {
        sessions: rows.reduce((t, s) => t + s.sessions, 0),
        hours: round2(rows.reduce((t, s) => t + s.hours, 0)),
        revenue: roundUsd(rows.reduce((t, s) => t + s.revenue, 0)),
      };
    };

    const cur = current.totals;
    const prev = previous.totals;
    return {
      period,
      timezone,
      comparison: resolved.comparison,
      range: rangeOut(resolved.range),
      previous: rangeOut(resolved.previous),
      openHours: round2(current.openMs / 3_600_000),
      kpis: {
        revenue: moneyKpi(cur.revenue, prev.revenue),
        orders: countKpi(cur.orders, prev.orders),
        avgOrder: moneyKpi(average(cur.revenue, cur.orders), average(prev.revenue, prev.orders)),
        gamingRevenue: moneyKpi(cur.gaming, prev.gaming),
        productRevenue: moneyKpi(cur.products, prev.products),
        gamingHours: countKpi(round2(current.gamingHours), round2(previous.gamingHours)),
        sessions: countKpi(current.sessions, previous.sessions),
        discounts: moneyKpi(cur.discounts, prev.discounts),
        newCustomers: countKpi(current.newCustomers, previous.newCustomers),
        websiteOrders: countKpi(current.websiteOrders, previous.websiteOrders),
        reservations: countKpi(current.reservations, previous.reservations),
        noShows: countKpi(current.noShows, previous.noShows),
      },
      series: revenueSeries(current.ledger, resolved.buckets),
      byPaymentMethod: byPaymentMethod(current.ledger),
      byCategory: byCategory(current.ledger, categoryOf),
      topProducts: topProducts(current.ledger, 10),
      stations,
      byStationType: { pc: byType(StationType.PC), playstation: byType(StationType.PLAYSTATION) },
      busiestHours: busiestHours(current.ledger, timezone),
      cashiers: byStaff(current.ledger, staffName),
    };
  }
}

export default new SummaryReportService();
