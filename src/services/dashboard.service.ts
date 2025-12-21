import Sale, { SaleStatus } from "../models/sale.model";
import Product, { ProductType } from "../models/product.model";
import Category from "../models/category.model";
import Customer from "../models/customer.model";
import GamingSession, {
  SessionStatus,
  SessionPaymentStatus,
} from "../models/gamingsession.model";

interface RevenueBreakdown {
  usd: number;
  lbp: number;
}

interface SeparatedRevenue {
  total: RevenueBreakdown;
  products: RevenueBreakdown;  // Physical products (non-gaming)
  gaming: RevenueBreakdown;    // Gaming category products + gaming sessions
}

interface DailySales {
  date: string;
  totalSales: number;
  revenue: SeparatedRevenue;
  itemsSold: number;
  productSales: number;   // Number of product-only sales
  gamingSales: number;    // Number of gaming-related sales
}

interface RevenueStats {
  totalRevenue: SeparatedRevenue;
  totalSales: number;
  productSales: number;
  gamingSales: number;
  averageSaleValue: RevenueBreakdown;
  itemsSold: number;
}

class DashboardService {
  // Cache gaming category ID
  private gamingCategoryId: string | null = null;

  private async getGamingCategoryId(): Promise<string | null> {
    if (this.gamingCategoryId) return this.gamingCategoryId;

    const gamingCategory = await Category.findOne({
      name: { $regex: /^gaming$/i },
      isActive: true
    });

    if (gamingCategory) {
      this.gamingCategoryId = gamingCategory._id.toString();
    }
    return this.gamingCategoryId;
  }

  private async getGamingProductIds(): Promise<Set<string>> {
    const gamingCategoryId = await this.getGamingCategoryId();
    if (!gamingCategoryId) return new Set();

    const gamingProducts = await Product.find({
      $or: [
        { category: gamingCategoryId },
        { productType: ProductType.SERVICE }
      ],
      isActive: true
    }).select('_id');

    return new Set(gamingProducts.map(p => p._id.toString()));
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
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const [sales, newCustomers, gamingSessions, gamingProductIds] = await Promise.all([
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
      this.getGamingProductIds(),
    ]);

    const paidSales = sales.filter((s) => s.status === SaleStatus.PAID);
    const pendingSalesArr = sales.filter((s) => s.status === SaleStatus.PENDING);

    // Calculate separated revenue from sales
    const salesRevenue = this.calculateSeparatedRevenue(paidSales, gamingProductIds);

    // Add gaming session revenue to gaming total
    const gamingSessionRevenue = gamingSessions.reduce(
      (acc, session) => ({
        usd: acc.usd + (session.finalAmount?.usd || session.totalCost?.usd || 0),
        lbp: acc.lbp + (session.finalAmount?.lbp || session.totalCost?.lbp || 0),
      }),
      { usd: 0, lbp: 0 }
    );

    const revenue: SeparatedRevenue = {
      total: {
        usd: salesRevenue.total.usd + gamingSessionRevenue.usd,
        lbp: salesRevenue.total.lbp + gamingSessionRevenue.lbp,
      },
      products: salesRevenue.products,
      gaming: {
        usd: salesRevenue.gaming.usd + gamingSessionRevenue.usd,
        lbp: salesRevenue.gaming.lbp + gamingSessionRevenue.lbp,
      },
    };

    const itemsSold = paidSales.reduce(
      (acc, sale) =>
        acc + sale.items.reduce((sum, item) => sum + item.quantity, 0),
      0
    );

    // Count sales by type
    const { productSales, gamingSales } = this.countSalesByType(paidSales, gamingProductIds);

    return {
      revenue,
      totalSales: sales.length,
      pendingSales: pendingSalesArr.length,
      paidSales: paidSales.length,
      productSales,
      gamingSales: gamingSales + gamingSessions.length,
      itemsSold,
      newCustomers,
      gamingSessions: gamingSessions.length,
    };
  }

  private calculateSeparatedRevenue(
    sales: any[],
    gamingProductIds: Set<string>
  ): SeparatedRevenue {
    const result: SeparatedRevenue = {
      total: { usd: 0, lbp: 0 },
      products: { usd: 0, lbp: 0 },
      gaming: { usd: 0, lbp: 0 },
    };

    for (const sale of sales) {
      for (const item of sale.items) {
        const isGaming = gamingProductIds.has(item.product.toString());
        const itemRevenue = item.finalAmount || item.subtotal;

        if (isGaming) {
          result.gaming.usd += itemRevenue.usd;
          result.gaming.lbp += itemRevenue.lbp;
        } else {
          result.products.usd += itemRevenue.usd;
          result.products.lbp += itemRevenue.lbp;
        }
        result.total.usd += itemRevenue.usd;
        result.total.lbp += itemRevenue.lbp;
      }
    }

    return result;
  }

  private countSalesByType(
    sales: any[],
    gamingProductIds: Set<string>
  ): { productSales: number; gamingSales: number } {
    let productSales = 0;
    let gamingSales = 0;

    for (const sale of sales) {
      const hasGamingItem = sale.items.some((item: any) =>
        gamingProductIds.has(item.product.toString())
      );
      const hasProductItem = sale.items.some((item: any) =>
        !gamingProductIds.has(item.product.toString())
      );

      // A sale can count as both if it has mixed items
      if (hasProductItem) productSales++;
      if (hasGamingItem) gamingSales++;
    }

    return { productSales, gamingSales };
  }

  async getDailySales(startDate: Date, endDate: Date): Promise<DailySales[]> {
    const [sales, gamingSessions, gamingProductIds] = await Promise.all([
      Sale.find({
        createdAt: { $gte: startDate, $lte: endDate },
        status: SaleStatus.PAID,
      }),
      GamingSession.find({
        startTime: { $gte: startDate, $lte: endDate },
        status: SessionStatus.COMPLETED,
        paymentStatus: SessionPaymentStatus.PAID,
      }),
      this.getGamingProductIds(),
    ]);

    // Group sales by date
    const dailyData = new Map<string, {
      sales: any[];
      gamingSessions: any[];
    }>();

    // Group sales by date
    for (const sale of sales) {
      const date = sale.createdAt.toISOString().split('T')[0];
      if (!dailyData.has(date)) {
        dailyData.set(date, { sales: [], gamingSessions: [] });
      }
      dailyData.get(date)!.sales.push(sale);
    }

    // Group gaming sessions by date
    for (const session of gamingSessions) {
      const date = session.startTime.toISOString().split('T')[0];
      if (!dailyData.has(date)) {
        dailyData.set(date, { sales: [], gamingSessions: [] });
      }
      dailyData.get(date)!.gamingSessions.push(session);
    }

    // Calculate daily stats
    const result: DailySales[] = [];
    const sortedDates = Array.from(dailyData.keys()).sort();

    for (const date of sortedDates) {
      const dayData = dailyData.get(date)!;

      // Calculate separated revenue from sales
      const salesRevenue = this.calculateSeparatedRevenue(dayData.sales, gamingProductIds);

      // Add gaming session revenue
      const sessionRevenue = dayData.gamingSessions.reduce(
        (acc, session) => ({
          usd: acc.usd + (session.finalAmount?.usd || session.totalCost?.usd || 0),
          lbp: acc.lbp + (session.finalAmount?.lbp || session.totalCost?.lbp || 0),
        }),
        { usd: 0, lbp: 0 }
      );

      const revenue: SeparatedRevenue = {
        total: {
          usd: salesRevenue.total.usd + sessionRevenue.usd,
          lbp: salesRevenue.total.lbp + sessionRevenue.lbp,
        },
        products: salesRevenue.products,
        gaming: {
          usd: salesRevenue.gaming.usd + sessionRevenue.usd,
          lbp: salesRevenue.gaming.lbp + sessionRevenue.lbp,
        },
      };

      const itemsSold = dayData.sales.reduce(
        (acc, sale) =>
          acc + sale.items.reduce((sum: number, item: any) => sum + item.quantity, 0),
        0
      );

      const { productSales, gamingSales } = this.countSalesByType(dayData.sales, gamingProductIds);

      result.push({
        date,
        totalSales: dayData.sales.length + dayData.gamingSessions.length,
        revenue,
        itemsSold,
        productSales,
        gamingSales: gamingSales + dayData.gamingSessions.length,
      });
    }

    return result;
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
    const [sales, gamingSessions, gamingProductIds] = await Promise.all([
      Sale.find({
        createdAt: { $gte: startDate, $lte: endDate },
        status: SaleStatus.PAID,
      }),
      GamingSession.find({
        startTime: { $gte: startDate, $lte: endDate },
        status: SessionStatus.COMPLETED,
        paymentStatus: SessionPaymentStatus.PAID,
      }),
      this.getGamingProductIds(),
    ]);

    // Calculate separated revenue from sales
    const salesRevenue = this.calculateSeparatedRevenue(sales, gamingProductIds);

    // Add gaming session revenue
    const sessionRevenue = gamingSessions.reduce(
      (acc, session) => ({
        usd: acc.usd + (session.finalAmount?.usd || session.totalCost?.usd || 0),
        lbp: acc.lbp + (session.finalAmount?.lbp || session.totalCost?.lbp || 0),
      }),
      { usd: 0, lbp: 0 }
    );

    const totalRevenue: SeparatedRevenue = {
      total: {
        usd: salesRevenue.total.usd + sessionRevenue.usd,
        lbp: salesRevenue.total.lbp + sessionRevenue.lbp,
      },
      products: salesRevenue.products,
      gaming: {
        usd: salesRevenue.gaming.usd + sessionRevenue.usd,
        lbp: salesRevenue.gaming.lbp + sessionRevenue.lbp,
      },
    };

    const itemsSold = sales.reduce(
      (acc, sale) =>
        acc + sale.items.reduce((sum, item) => sum + item.quantity, 0),
      0
    );

    const { productSales, gamingSales } = this.countSalesByType(sales, gamingProductIds);
    const totalSales = sales.length + gamingSessions.length;

    return {
      totalRevenue,
      totalSales,
      productSales,
      gamingSales: gamingSales + gamingSessions.length,
      averageSaleValue: {
        usd: totalSales > 0 ? totalRevenue.total.usd / totalSales : 0,
        lbp: totalSales > 0 ? totalRevenue.total.lbp / totalSales : 0,
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
