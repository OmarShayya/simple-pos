import Sale, { SaleStatus } from "../models/sale.model";
import Product, { ProductType } from "../models/product.model";
import Customer from "../models/customer.model";
import GamingSession, {
  SessionStatus,
  SessionPaymentStatus,
} from "../models/gamingsession.model";
import { Money } from "../utils/money";
import { localDateRange, TimeRange } from "../utils/period";
import { localDateString } from "../utils/time";
import { getLoungeTimezone } from "./loungeSettings";
import { average, revenueTotals } from "./reports/ledgerAggregates";
import { LedgerEntry, loadLedger } from "./reports/revenueLedger";

/*
 * Audit note (orders overhaul): these endpoints used to add paid session revenue on top of paid
 * sales that already contained the same sessions as "SESSION-" lines (double counting), and
 * classified those lines as products because their `product` held the station id. Revenue now comes
 * from the shared revenue ledger (paid orders by payment time, lounge timezone, sessions once).
 */

interface SeparatedRevenue {
  total: Money;
  products: Money; // Menu products
  gaming: Money; // Station time
}

interface DailySales {
  date: string;
  totalSales: number;
  revenue: SeparatedRevenue;
  itemsSold: number;
  productSales: number; // Orders with at least one product line
  gamingSales: number; // Orders with at least one gaming line
}

interface RevenueStats {
  totalRevenue: SeparatedRevenue;
  totalSales: number;
  productSales: number;
  gamingSales: number;
  averageSaleValue: Money;
  itemsSold: number;
}

const separated = (entries: LedgerEntry[]): SeparatedRevenue => {
  const t = revenueTotals(entries);
  return { total: t.revenue, products: t.products, gaming: t.gaming };
};

const countByKind = (entries: LedgerEntry[]) => ({
  productSales: entries.filter((e) => e.lines.some((l) => l.kind === "product")).length,
  gamingSales: entries.filter((e) => e.lines.some((l) => l.kind === "gaming")).length,
  itemsSold: entries.reduce((n, e) => n + e.lines.filter((l) => l.kind === "product").reduce((q, l) => q + l.quantity, 0), 0),
});

class DashboardService {
  private async todayRange(): Promise<{ tz: string; range: TimeRange }> {
    const tz = await getLoungeTimezone();
    const today = localDateString(new Date(), tz);
    const { start, end } = localDateRange(tz, today, today);
    return { tz, range: { start: start!, end: end! } };
  }

  async getTodayStats(): Promise<{
    revenue: SeparatedRevenue;
    totalSales: number;
    pendingSales: number;
    paidSales: number;
    productSales: number;
    gamingSales: number;
    itemsSold: number;
    newCustomers: number;
    gamingSessions: number;
  }> {
    const { range } = await this.todayRange();
    const created = { $gte: range.start, $lt: range.end };
    const [entries, totalSales, pendingSales, newCustomers, gamingSessions] = await Promise.all([
      loadLedger(range),
      Sale.countDocuments({ createdAt: created, status: { $ne: SaleStatus.CANCELLED } }),
      Sale.countDocuments({ createdAt: created, status: SaleStatus.PENDING }),
      Customer.countDocuments({ createdAt: created }),
      GamingSession.countDocuments({ startTime: created, status: { $ne: SessionStatus.CANCELLED } }),
    ]);

    return {
      revenue: separated(entries),
      totalSales,
      pendingSales,
      paidSales: entries.length,
      ...countByKind(entries),
      newCustomers,
      gamingSessions,
    };
  }

  async getDailySales(startDate: Date, endDate: Date): Promise<DailySales[]> {
    const tz = await getLoungeTimezone();
    const entries = await loadLedger({ start: startDate, end: new Date(endDate.getTime() + 1) });
    const byDay = new Map<string, LedgerEntry[]>();
    for (const e of entries) {
      const day = localDateString(e.at, tz);
      byDay.set(day, [...(byDay.get(day) ?? []), e]);
    }
    return [...byDay.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, list]) => ({ date, totalSales: list.length, revenue: separated(list), ...countByKind(list) }));
  }

  async getWeeklyStats(): Promise<RevenueStats> {
    const today = new Date();
    const weekAgo = new Date(today);
    weekAgo.setDate(weekAgo.getDate() - 7);

    return this.getRevenueStats(weekAgo, today);
  }

  async getMonthlyStats(): Promise<RevenueStats> {
    const today = new Date();
    const monthAgo = new Date(today);
    monthAgo.setMonth(monthAgo.getMonth() - 1);

    return this.getRevenueStats(monthAgo, today);
  }

  async getCustomDateRangeStats(startDate: Date, endDate: Date): Promise<RevenueStats> {
    return this.getRevenueStats(startDate, endDate);
  }

  private async getRevenueStats(startDate: Date, endDate: Date): Promise<RevenueStats> {
    const entries = await loadLedger({ start: startDate, end: new Date(endDate.getTime() + 1) });
    const revenue = separated(entries);
    return {
      totalRevenue: revenue,
      totalSales: entries.length,
      ...countByKind(entries),
      averageSaleValue: average(revenue.total, entries.length),
    };
  }

  async getTopSellingProducts(limit: number = 10): Promise<
    Array<{
      productId: string;
      productName: string;
      productSku: string;
      totalQuantitySold: number;
      totalRevenue: { usd: number; lbp: number };
      salesCount: number;
    }>
  > {
    const topProducts = await Sale.aggregate([
      {
        $match: { status: SaleStatus.PAID },
      },
      {
        $unwind: "$items",
      },
      {
        $match: { "items.kind": { $ne: "gaming" }, "items.product": { $ne: null } },
      },
      {
        $group: {
          _id: "$items.product",
          productName: { $first: "$items.productName" },
          productSku: { $first: "$items.productSku" },
          totalQuantitySold: { $sum: "$items.quantity" },
          totalRevenueUsd: { $sum: "$items.subtotal.usd" },
          totalRevenueLbp: { $sum: "$items.subtotal.lbp" },
          salesCount: { $sum: 1 },
        },
      },
      {
        $sort: { totalQuantitySold: -1 },
      },
      {
        $limit: limit,
      },
    ]);

    return topProducts.map((product) => ({
      productId: product._id.toString(),
      productName: product.productName,
      productSku: product.productSku,
      totalQuantitySold: product.totalQuantitySold,
      totalRevenue: {
        usd: product.totalRevenueUsd,
        lbp: product.totalRevenueLbp,
      },
      salesCount: product.salesCount,
    }));
  }

  async getLowStockProducts(): Promise<
    Array<{
      id: string;
      name: string;
      sku: string;
      currentStock: number;
      minStockLevel: number;
      category: string;
    }>
  > {
    const products = await Product.find({
      isActive: true,
      productType: ProductType.PHYSICAL,
      "inventory.isLowStock": true,
    })
      .populate("category", "name")
      .sort({ "inventory.quantity": 1 });

    return products.map((product) => ({
      id: product._id.toString(),
      name: product.name,
      sku: product.sku || "",
      currentStock: product.inventory?.quantity || 0,
      minStockLevel: product.inventory?.minStockLevel || 0,
      category: (product.category as any).name,
    }));
  }

  async getCustomerStats(): Promise<{
    totalCustomers: number;
    customersWithBalance: number;
    topCustomers: Array<{
      id: string;
      name: string;
      phone: string;
      totalPurchases: number;
      lastPurchase: Date;
    }>;
  }> {
    const [totalCustomers, customersWithBalance, topCustomers] =
      await Promise.all([
        Customer.countDocuments({ isActive: true }),
        Customer.countDocuments({
          isActive: true,
          $or: [{ "balance.usd": { $gt: 0 } }, { "balance.lbp": { $gt: 0 } }],
        }),
        Customer.find({ isActive: true })
          .sort({ totalPurchases: -1 })
          .limit(5)
          .select("name phone totalPurchases lastPurchaseDate"),
      ]);

    return {
      totalCustomers,
      customersWithBalance,
      topCustomers: topCustomers.map((customer) => ({
        id: customer._id.toString(),
        name: customer.name,
        phone: customer.phone,
        totalPurchases: customer.totalPurchases,
        lastPurchase: customer.lastPurchaseDate!,
      })),
    };
  }

  async getCashierPerformance(
    startDate?: Date,
    endDate?: Date
  ): Promise<
    Array<{
      cashierId: string;
      cashierName: string;
      totalSales: number;
      totalRevenue: { usd: number; lbp: number };
      averageSaleValue: { usd: number; lbp: number };
    }>
  > {
    const query: any = { status: SaleStatus.PAID };

    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = startDate;
      if (endDate) query.createdAt.$lte = endDate;
    }

    const performance = await Sale.aggregate([
      { $match: query },
      {
        $group: {
          _id: "$cashier",
          totalSales: { $sum: 1 },
          totalRevenueUsd: { $sum: "$totals.usd" },
          totalRevenueLbp: { $sum: "$totals.lbp" },
        },
      },
      {
        $lookup: {
          from: "users",
          localField: "_id",
          foreignField: "_id",
          as: "cashier",
        },
      },
      {
        $unwind: "$cashier",
      },
      {
        $sort: { totalRevenueUsd: -1 },
      },
    ]);

    return performance.map((perf) => ({
      cashierId: perf._id.toString(),
      cashierName: perf.cashier.name,
      totalSales: perf.totalSales,
      totalRevenue: {
        usd: perf.totalRevenueUsd,
        lbp: perf.totalRevenueLbp,
      },
      averageSaleValue: {
        usd: perf.totalRevenueUsd / perf.totalSales,
        lbp: perf.totalRevenueLbp / perf.totalSales,
      },
    }));
  }

  async getPendingSalesValue(): Promise<{
    totalPending: number;
    totalValue: { usd: number; lbp: number };
    pendingSales: Array<{
      invoiceNumber: string;
      customer: string | null;
      total: { usd: number; lbp: number };
      createdAt: Date;
    }>;
  }> {
    const pendingSales = await Sale.find({
      status: SaleStatus.PENDING,
    })
      .populate("customer", "name phone")
      .sort({ createdAt: -1 });

    const totalValue = pendingSales.reduce(
      (acc, sale) => ({
        usd: acc.usd + sale.totals.usd,
        lbp: acc.lbp + sale.totals.lbp,
      }),
      { usd: 0, lbp: 0 }
    );

    return {
      totalPending: pendingSales.length,
      totalValue,
      pendingSales: pendingSales.map((sale) => ({
        invoiceNumber: sale.invoiceNumber,
        customer: sale.customer ? (sale.customer as any).name : null,
        total: sale.totals,
        createdAt: sale.createdAt,
      })),
    };
  }

  async getInventoryValue(): Promise<{
    totalProducts: number;
    totalInventoryValue: { usd: number; lbp: number };
    lowStockCount: number;
  }> {
    const products = await Product.find({
      isActive: true,
      productType: ProductType.PHYSICAL,
    });

    const totalInventoryValue = products.reduce(
      (acc, product) => ({
        usd: acc.usd + product.pricing.usd * (product.inventory?.quantity || 0),
        lbp: acc.lbp + product.pricing.lbp * (product.inventory?.quantity || 0),
      }),
      { usd: 0, lbp: 0 }
    );

    const lowStockCount = products.filter((p) => p.inventory?.isLowStock).length;

    return {
      totalProducts: products.length,
      totalInventoryValue,
      lowStockCount,
    };
  }

  async getOverallStats(): Promise<{
    today: any;
    week: RevenueStats;
    month: RevenueStats;
    topProducts: any[];
    lowStock: any[];
    customerStats: any;
    pendingSales: any;
    inventoryValue: any;
  }> {
    const [
      today,
      week,
      month,
      topProducts,
      lowStock,
      customerStats,
      pendingSales,
      inventoryValue,
    ] = await Promise.all([
      this.getTodayStats(),
      this.getWeeklyStats(),
      this.getMonthlyStats(),
      this.getTopSellingProducts(5),
      this.getLowStockProducts(),
      this.getCustomerStats(),
      this.getPendingSalesValue(),
      this.getInventoryValue(),
    ]);

    return {
      today,
      week,
      month,
      topProducts,
      lowStock,
      customerStats,
      pendingSales,
      inventoryValue,
    };
  }

  async getGamingStats(): Promise<{
    todayRevenue: { usd: number; lbp: number };
    activeSessions: number;
    completedToday: number;
    unpaidSessions: number;
  }> {
    const { range } = await this.todayRange();
    const [entries, sessions] = await Promise.all([
      loadLedger(range),
      GamingSession.find({ startTime: { $gte: range.start, $lt: range.end } }).select("status paymentStatus"),
    ]);
    return {
      // Station time paid today (ledger gaming lines), not session totals
      todayRevenue: revenueTotals(entries).gaming,
      activeSessions: await GamingSession.countDocuments({ status: SessionStatus.ACTIVE }),
      completedToday: sessions.filter((s) => s.status === SessionStatus.COMPLETED).length,
      unpaidSessions: sessions.filter(
        (s) => s.status === SessionStatus.COMPLETED && s.paymentStatus === SessionPaymentStatus.UNPAID
      ).length,
    };
  }
}

export default new DashboardService();
