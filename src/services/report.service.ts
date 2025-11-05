import Sale, { SaleStatus, Currency } from "../models/sale.model";
import Product from "../models/product.model";
import Category from "../models/category.model";
import {
  startOfWeek,
  endOfWeek,
  startOfMonth,
  endOfMonth,
  startOfYear,
  endOfYear,
} from "date-fns";

interface RevenueBreakdown {
  total: {
    usd: number;
    lbp: number;
  };
  usdPayments: {
    usd: number;
    lbp: number;
  };
  lbpPayments: {
    usd: number;
    lbp: number;
  };
  totalSales: number;
  averageSale: {
    usd: number;
    lbp: number;
  };
}

class ReportService {
  private async getRevenueBreakdown(
    startDate: Date,
    endDate: Date
  ): Promise<RevenueBreakdown> {
    const sales = await Sale.find({
      createdAt: { $gte: startDate, $lte: endDate },
      status: SaleStatus.PAID,
    });

    const usdPaymentSales = sales.filter(
      (s) => s.paymentCurrency === Currency.USD
    );
    const lbpPaymentSales = sales.filter(
      (s) => s.paymentCurrency === Currency.LBP
    );

    const totalRevenue = sales.reduce(
      (acc, sale) => ({
        usd: acc.usd + sale.amountPaid.usd,
        lbp: acc.lbp + sale.amountPaid.lbp,
      }),
      { usd: 0, lbp: 0 }
    );

    const usdPaymentsRevenue = usdPaymentSales.reduce(
      (acc, sale) => ({
        usd: acc.usd + sale.amountPaid.usd,
        lbp: acc.lbp + sale.amountPaid.lbp,
      }),
      { usd: 0, lbp: 0 }
    );

    const lbpPaymentsRevenue = lbpPaymentSales.reduce(
      (acc, sale) => ({
        usd: acc.usd + sale.amountPaid.usd,
        lbp: acc.lbp + sale.amountPaid.lbp,
      }),
      { usd: 0, lbp: 0 }
    );

    const totalSales = sales.length;

    return {
      total: totalRevenue,
      usdPayments: usdPaymentsRevenue,
      lbpPayments: lbpPaymentsRevenue,
      totalSales,
      averageSale: {
        usd: totalSales > 0 ? totalRevenue.usd / totalSales : 0,
        lbp: totalSales > 0 ? totalRevenue.lbp / totalSales : 0,
      },
    };
  }

  async getDailyReport(date: Date) {
    const dayStart = new Date(date);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(date);
    dayEnd.setHours(23, 59, 59, 999);

    const revenue = await this.getRevenueBreakdown(dayStart, dayEnd);

    const hourlyBreakdown = await Sale.aggregate([
      {
        $match: {
          createdAt: { $gte: dayStart, $lte: dayEnd },
          status: SaleStatus.PAID,
        },
      },
      {
        $group: {
          _id: {
            $hour: "$createdAt",
          },
          totalSales: { $sum: 1 },
          totalUsd: { $sum: "$amountPaid.usd" },
          totalLbp: { $sum: "$amountPaid.lbp" },
        },
      },
      {
        $sort: { _id: 1 },
      },
    ]);

    return {
      period: {
        type: "daily",
        date: dayStart,
      },
      revenue,
      hourlyBreakdown: hourlyBreakdown.map((hour) => ({
        hour: hour._id,
        totalSales: hour.totalSales,
        revenue: { usd: hour.totalUsd, lbp: hour.totalLbp },
      })),
    };
  }

  async getWeeklyReport(week: number, month: number, year: number) {
    // Calculate the date for the specific week
    const monthStart = new Date(year, month - 1, 1);
    const weekStartDate = new Date(monthStart);
    weekStartDate.setDate(monthStart.getDate() + (week - 1) * 7);

    const startDate = startOfWeek(weekStartDate, { weekStartsOn: 1 });
    const endDate = endOfWeek(weekStartDate, { weekStartsOn: 1 });

    const revenue = await this.getRevenueBreakdown(startDate, endDate);

    const dailyBreakdown = await this.getDailyBreakdown(startDate, endDate);

    return {
      period: {
        type: "weekly",
        week,
        month,
        year,
        startDate,
        endDate,
      },
      revenue,
      dailyBreakdown,
    };
  }

  async getMonthlyReport(month: number, year: number) {
    const startDate = startOfMonth(new Date(year, month - 1));
    const endDate = endOfMonth(new Date(year, month - 1));

    const revenue = await this.getRevenueBreakdown(startDate, endDate);

    const dailyBreakdown = await this.getDailyBreakdown(startDate, endDate);

    const weeklyBreakdown = await this.getWeeklyBreakdown(startDate, endDate);

    return {
      period: {
        type: "monthly",
        month,
        year,
        startDate,
        endDate,
      },
      revenue,
      dailyBreakdown,
      weeklyBreakdown,
    };
  }

  async getYearlyReport(year: number) {
    const startDate = startOfYear(new Date(year, 0));
    const endDate = endOfYear(new Date(year, 0));

    const revenue = await this.getRevenueBreakdown(startDate, endDate);

    const monthlyBreakdown = await this.getMonthlyBreakdown(startDate, endDate);

    return {
      period: {
        type: "yearly",
        year,
        startDate,
        endDate,
      },
      revenue,
      monthlyBreakdown,
    };
  }

  private async getDailyBreakdown(startDate: Date, endDate: Date) {
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
          totalUsd: { $sum: "$amountPaid.usd" },
          totalLbp: { $sum: "$amountPaid.lbp" },
          usdPayments: {
            $sum: {
              $cond: [
                { $eq: ["$paymentCurrency", Currency.USD] },
                "$amountPaid.usd",
                0,
              ],
            },
          },
          lbpPayments: {
            $sum: {
              $cond: [
                { $eq: ["$paymentCurrency", Currency.LBP] },
                "$amountPaid.lbp",
                0,
              ],
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
        total: { usd: day.totalUsd, lbp: day.totalLbp },
        usdPayments: day.usdPayments,
        lbpPayments: day.lbpPayments,
      },
    }));
  }

  private async getWeeklyBreakdown(startDate: Date, endDate: Date) {
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
            $week: "$createdAt",
          },
          totalSales: { $sum: 1 },
          totalUsd: { $sum: "$amountPaid.usd" },
          totalLbp: { $sum: "$amountPaid.lbp" },
        },
      },
      {
        $sort: { _id: 1 },
      },
    ]);

    return sales.map((week) => ({
      week: week._id,
      totalSales: week.totalSales,
      revenue: { usd: week.totalUsd, lbp: week.totalLbp },
    }));
  }

  private async getMonthlyBreakdown(startDate: Date, endDate: Date) {
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
            $month: "$createdAt",
          },
          totalSales: { $sum: 1 },
          totalUsd: { $sum: "$amountPaid.usd" },
          totalLbp: { $sum: "$amountPaid.lbp" },
          usdPayments: {
            $sum: {
              $cond: [
                { $eq: ["$paymentCurrency", Currency.USD] },
                "$amountPaid.usd",
                0,
              ],
            },
          },
          lbpPayments: {
            $sum: {
              $cond: [
                { $eq: ["$paymentCurrency", Currency.LBP] },
                "$amountPaid.lbp",
                0,
              ],
            },
          },
        },
      },
      {
        $sort: { _id: 1 },
      },
    ]);

    return sales.map((month) => ({
      month: month._id,
      totalSales: month.totalSales,
      revenue: {
        total: { usd: month.totalUsd, lbp: month.totalLbp },
        usdPayments: month.usdPayments,
        lbpPayments: month.lbpPayments,
      },
    }));
  }

  async getSalesByCategory(
    categoryId?: string,
    startDate?: Date,
    endDate?: Date
  ) {
    const matchQuery: any = {
      status: SaleStatus.PAID,
    };

    if (startDate && endDate) {
      matchQuery.createdAt = { $gte: startDate, $lte: endDate };
    }

    const pipeline: any[] = [
      { $match: matchQuery },
      { $unwind: "$items" },
      {
        $lookup: {
          from: "products",
          localField: "items.product",
          foreignField: "_id",
          as: "productInfo",
        },
      },
      { $unwind: "$productInfo" },
    ];

    if (categoryId) {
      pipeline.push({
        $match: { "productInfo.category": categoryId },
      });
    }

    pipeline.push(
      {
        $lookup: {
          from: "categories",
          localField: "productInfo.category",
          foreignField: "_id",
          as: "categoryInfo",
        },
      },
      { $unwind: "$categoryInfo" },
      {
        $group: {
          _id: "$categoryInfo._id",
          categoryName: { $first: "$categoryInfo.name" },
          totalQuantity: { $sum: "$items.quantity" },
          totalRevenueUsd: { $sum: "$items.subtotal.usd" },
          totalRevenueLbp: { $sum: "$items.subtotal.lbp" },
          salesCount: { $sum: 1 },
        },
      },
      {
        $sort: { totalRevenueUsd: -1 },
      }
    );

    const results = await Sale.aggregate(pipeline);

    return results.map((cat) => ({
      categoryId: cat._id.toString(),
      categoryName: cat.categoryName,
      totalQuantitySold: cat.totalQuantity,
      totalRevenue: {
        usd: cat.totalRevenueUsd,
        lbp: cat.totalRevenueLbp,
      },
      salesCount: cat.salesCount,
    }));
  }

  async getSalesByProduct(
    productId?: string,
    startDate?: Date,
    endDate?: Date
  ) {
    const matchQuery: any = {
      status: SaleStatus.PAID,
    };

    if (startDate && endDate) {
      matchQuery.createdAt = { $gte: startDate, $lte: endDate };
    }

    const pipeline: any[] = [{ $match: matchQuery }, { $unwind: "$items" }];

    if (productId) {
      pipeline.push({
        $match: { "items.product": productId },
      });
    }

    pipeline.push(
      {
        $group: {
          _id: "$items.product",
          productName: { $first: "$items.productName" },
          productSku: { $first: "$items.productSku" },
          totalQuantity: { $sum: "$items.quantity" },
          totalRevenueUsd: { $sum: "$items.subtotal.usd" },
          totalRevenueLbp: { $sum: "$items.subtotal.lbp" },
          salesCount: { $sum: 1 },
        },
      },
      {
        $sort: { totalRevenueUsd: -1 },
      }
    );

    const results = await Sale.aggregate(pipeline);

    return results.map((prod) => ({
      productId: prod._id.toString(),
      productName: prod.productName,
      productSku: prod.productSku,
      totalQuantitySold: prod.totalQuantity,
      totalRevenue: {
        usd: prod.totalRevenueUsd,
        lbp: prod.totalRevenueLbp,
      },
      salesCount: prod.salesCount,
    }));
  }

  async getDailyTransactions(
    date: Date,
    startDate?: Date,
    endDate?: Date,
    page: number = 1,
    limit: number = 50
  ) {
    let query: any = {
      status: { $ne: SaleStatus.CANCELLED },
    };

    if (startDate && endDate) {
      query.createdAt = { $gte: startDate, $lte: endDate };
    } else {
      // Default to the specific date
      const dayStart = new Date(date);
      dayStart.setHours(0, 0, 0, 0);
      const dayEnd = new Date(date);
      dayEnd.setHours(23, 59, 59, 999);
      query.createdAt = { $gte: dayStart, $lte: dayEnd };
    }

    const skip = (page - 1) * limit;

    const [transactions, total] = await Promise.all([
      Sale.find(query)
        .populate("customer", "name phone")
        .populate("cashier", "name")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      Sale.countDocuments(query),
    ]);

    return {
      transactions: transactions.map((sale) => ({
        id: sale._id.toString(),
        invoiceNumber: sale.invoiceNumber,
        customer: sale.customer
          ? {
              name: (sale.customer as any).name,
              phone: (sale.customer as any).phone,
            }
          : null,
        totals: sale.totals,
        amountPaid: sale.amountPaid,
        paymentMethod: sale.paymentMethod,
        paymentCurrency: sale.paymentCurrency,
        status: sale.status,
        cashier: (sale.cashier as any).name,
        createdAt: sale.createdAt,
      })),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async exportToCSV(type: string, startDate: Date, endDate: Date) {
    const sales = await Sale.find({
      createdAt: { $gte: startDate, $lte: endDate },
      status: SaleStatus.PAID,
    })
      .populate("customer", "name phone")
      .populate("cashier", "name")
      .sort({ createdAt: 1 });

    const headers = [
      "Invoice Number",
      "Date",
      "Customer",
      "Total USD",
      "Total LBP",
      "Payment Method",
      "Payment Currency",
      "Amount Paid USD",
      "Amount Paid LBP",
      "Cashier",
      "Status",
    ].join(",");

    const rows = sales.map((sale) => {
      return [
        sale.invoiceNumber,
        sale.createdAt.toISOString(),
        sale.customer ? (sale.customer as any).name : "Walk-in",
        sale.totals.usd,
        sale.totals.lbp,
        sale.paymentMethod || "",
        sale.paymentCurrency || "",
        sale.amountPaid.usd,
        sale.amountPaid.lbp,
        (sale.cashier as any).name,
        sale.status,
      ].join(",");
    });

    return [headers, ...rows].join("\n");
  }
}

export default new ReportService();
