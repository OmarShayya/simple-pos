import Sale, { SaleStatus } from "../models/sale.model";
import Product from "../models/product.model";
import Customer from "../models/customer.model";
import GamingSession, {
  SessionStatus,
  SessionPaymentStatus,
} from "../models/gamingsession.model";

interface DailySales {
  date: string;
  totalSales: number;
  revenue: {
    usd: number;
    lbp: number;
  };
  itemsSold: number;
}

interface RevenueStats {
  totalRevenue: { usd: number; lbp: number };
  totalSales: number;
  averageSaleValue: { usd: number; lbp: number };
  itemsSold: number;
}

class DashboardService {
  async getTodayStats(): Promise<{
    revenue: { usd: number; lbp: number };
    totalSales: number;
    pendingSales: number;
    paidSales: number;
    itemsSold: number;
    newCustomers: number;
    gamingRevenue: { usd: number; lbp: number };
    gamingSessions: number;
  }> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const [sales, newCustomers, gamingSessions] = await Promise.all([
      Sale.find({
        createdAt: { $gte: today, $lt: tomorrow },
        status: { $ne: SaleStatus.CANCELLED },
      }),
      Customer.countDocuments({
        createdAt: { $gte: today, $lt: tomorrow },
      }),
      GamingSession.find({
        startTime: { $gte: today, $lt: tomorrow },
        status: SessionStatus.COMPLETED,
        paymentStatus: SessionPaymentStatus.PAID,
      }),
    ]);

    const paidSales = sales.filter((s) => s.status === SaleStatus.PAID);
    const pendingSales = sales.filter((s) => s.status === SaleStatus.PENDING);

    const revenue = paidSales.reduce(
      (acc, sale) => ({
        usd: acc.usd + sale.totals.usd,
        lbp: acc.lbp + sale.totals.lbp,
      }),
      { usd: 0, lbp: 0 }
    );

    const itemsSold = paidSales.reduce(
      (acc, sale) =>
        acc + sale.items.reduce((sum, item) => sum + item.quantity, 0),
      0
    );

    const gamingRevenue = gamingSessions.reduce(
      (acc, session) => ({
        usd: acc.usd + (session.totalCost?.usd || 0),
        lbp: acc.lbp + (session.totalCost?.lbp || 0),
      }),
      { usd: 0, lbp: 0 }
    );

    return {
      revenue,
      totalSales: sales.length,
      pendingSales: pendingSales.length,
      paidSales: paidSales.length,
      itemsSold,
      newCustomers,
      gamingRevenue,
      gamingSessions: gamingSessions.length,
    };
  }

  async getDailySales(startDate: Date, endDate: Date): Promise<DailySales[]> {
    const sales = await Sale.aggregate([
      {
        $match: {
          createdAt: { $gte: startDate, $lte: endDate },
          status: SaleStatus.PAID,
        },
      },
      {
        $group: {
          _id: {
            $dateToString: { format: "%Y-%m-%d", date: "$createdAt" },
          },
          totalSales: { $sum: 1 },
          revenueUsd: { $sum: "$totals.usd" },
          revenueLbp: { $sum: "$totals.lbp" },
          itemsSold: {
            $sum: {
              $sum: "$items.quantity",
            },
          },
        },
      },
      {
        $sort: { _id: 1 },
      },
    ]);

    return sales.map((day) => ({
      date: day._id,
      totalSales: day.totalSales,
      revenue: {
        usd: day.revenueUsd,
        lbp: day.revenueLbp,
      },
      itemsSold: day.itemsSold,
    }));
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

  async getCustomDateRangeStats(
    startDate: Date,
    endDate: Date
  ): Promise<RevenueStats> {
    return this.getRevenueStats(startDate, endDate);
  }

  private async getRevenueStats(
    startDate: Date,
    endDate: Date
  ): Promise<RevenueStats> {
    const sales = await Sale.find({
      createdAt: { $gte: startDate, $lte: endDate },
      status: SaleStatus.PAID,
    });

    const totalRevenue = sales.reduce(
      (acc, sale) => ({
        usd: acc.usd + sale.totals.usd,
        lbp: acc.lbp + sale.totals.lbp,
      }),
      { usd: 0, lbp: 0 }
    );

    const itemsSold = sales.reduce(
      (acc, sale) =>
        acc + sale.items.reduce((sum, item) => sum + item.quantity, 0),
      0
    );

    const totalSales = sales.length;

    return {
      totalRevenue,
      totalSales,
      averageSaleValue: {
        usd: totalSales > 0 ? totalRevenue.usd / totalSales : 0,
        lbp: totalSales > 0 ? totalRevenue.lbp / totalSales : 0,
      },
      itemsSold,
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
      "inventory.isLowStock": true,
    })
      .populate("category", "name")
      .sort({ "inventory.quantity": 1 });

    return products.map((product) => ({
      id: product._id.toString(),
      name: product.name,
      sku: product.sku,
      currentStock: product.inventory.quantity,
      minStockLevel: product.inventory.minStockLevel,
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
    const products = await Product.find({ isActive: true });

    const totalInventoryValue = products.reduce(
      (acc, product) => ({
        usd: acc.usd + product.pricing.usd * product.inventory.quantity,
        lbp: acc.lbp + product.pricing.lbp * product.inventory.quantity,
      }),
      { usd: 0, lbp: 0 }
    );

    const lowStockCount = products.filter((p) => p.inventory.isLowStock).length;

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
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const sessions = await GamingSession.find({
      startTime: { $gte: today, $lt: tomorrow },
    });

    const paidSessions = sessions.filter(
      (s) => s.paymentStatus === SessionPaymentStatus.PAID
    );

    const todayRevenue = paidSessions.reduce(
      (acc, session) => ({
        usd: acc.usd + (session.totalCost?.usd || 0),
        lbp: acc.lbp + (session.totalCost?.lbp || 0),
      }),
      { usd: 0, lbp: 0 }
    );

    const activeSessions = sessions.filter(
      (s) => s.status === SessionStatus.ACTIVE
    ).length;

    const completedToday = sessions.filter(
      (s) => s.status === SessionStatus.COMPLETED
    ).length;

    const unpaidSessions = sessions.filter(
      (s) =>
        s.status === SessionStatus.COMPLETED &&
        s.paymentStatus === SessionPaymentStatus.UNPAID
    ).length;

    return {
      todayRevenue,
      activeSessions,
      completedToday,
      unpaidSessions,
    };
  }
}

export default new DashboardService();
