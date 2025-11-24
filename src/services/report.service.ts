import Sale, { SaleStatus, Currency } from "../models/sale.model";
import {
  startOfWeek,
  endOfWeek,
  startOfMonth,
  endOfMonth,
  startOfYear,
  endOfYear,
} from "date-fns";
import GamingSession, {
  SessionStatus,
  SessionPaymentStatus,
} from "../models/gamingsession.model";

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
  discounts: {
    totalItemDiscounts: {
      usd: number;
      lbp: number;
    };
    totalSaleDiscounts: {
      usd: number;
      lbp: number;
    };
    totalDiscounts: {
      usd: number;
      lbp: number;
    };
    revenueBeforeDiscounts: {
      usd: number;
      lbp: number;
    };
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

    // Calculate discount totals
    const totalItemDiscounts = sales.reduce(
      (acc, sale) => ({
        usd: acc.usd + (sale.totalItemDiscounts?.usd || 0),
        lbp: acc.lbp + (sale.totalItemDiscounts?.lbp || 0),
      }),
      { usd: 0, lbp: 0 }
    );

    const totalSaleDiscounts = sales.reduce(
      (acc, sale) => ({
        usd: acc.usd + (sale.saleDiscount?.amount.usd || 0),
        lbp: acc.lbp + (sale.saleDiscount?.amount.lbp || 0),
      }),
      { usd: 0, lbp: 0 }
    );

    const totalDiscounts = {
      usd: totalItemDiscounts.usd + totalSaleDiscounts.usd,
      lbp: totalItemDiscounts.lbp + totalSaleDiscounts.lbp,
    };

    const revenueBeforeDiscounts = {
      usd: totalRevenue.usd + totalDiscounts.usd,
      lbp: totalRevenue.lbp + totalDiscounts.lbp,
    };

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
      discounts: {
        totalItemDiscounts,
        totalSaleDiscounts,
        totalDiscounts,
        revenueBeforeDiscounts,
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
          revenueBeforeDiscount: {
            usd: { $sum: "$items.subtotal.usd" },
            lbp: { $sum: "$items.subtotal.lbp" },
          },
          totalDiscounts: {
            usd: { $sum: { $ifNull: ["$items.discount.amount.usd", 0] } },
            lbp: { $sum: { $ifNull: ["$items.discount.amount.lbp", 0] } },
          },
          totalRevenueUsd: { $sum: "$items.finalAmount.usd" },
          totalRevenueLbp: { $sum: "$items.finalAmount.lbp" },
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
      revenueBeforeDiscount: cat.revenueBeforeDiscount,
      totalDiscounts: cat.totalDiscounts,
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
          revenueBeforeDiscount: {
            usd: { $sum: "$items.subtotal.usd" },
            lbp: { $sum: "$items.subtotal.lbp" },
          },
          totalDiscounts: {
            usd: { $sum: { $ifNull: ["$items.discount.amount.usd", 0] } },
            lbp: { $sum: { $ifNull: ["$items.discount.amount.lbp", 0] } },
          },
          totalRevenueUsd: { $sum: "$items.finalAmount.usd" },
          totalRevenueLbp: { $sum: "$items.finalAmount.lbp" },
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
      revenueBeforeDiscount: prod.revenueBeforeDiscount,
      totalDiscounts: prod.totalDiscounts,
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
        subtotalBeforeDiscount: sale.subtotalBeforeDiscount,
        discounts: {
          itemDiscounts: sale.totalItemDiscounts,
          saleDiscount: sale.saleDiscount
            ? {
                name: sale.saleDiscount.discountName,
                percentage: sale.saleDiscount.percentage,
                amount: sale.saleDiscount.amount,
              }
            : null,
          totalDiscounts: {
            usd:
              (sale.totalItemDiscounts?.usd || 0) +
              (sale.saleDiscount?.amount.usd || 0),
            lbp:
              (sale.totalItemDiscounts?.lbp || 0) +
              (sale.saleDiscount?.amount.lbp || 0),
          },
        },
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
      "Subtotal Before Discount USD",
      "Subtotal Before Discount LBP",
      "Item Discounts USD",
      "Item Discounts LBP",
      "Sale Discount USD",
      "Sale Discount LBP",
      "Sale Discount Name",
      "Total Discounts USD",
      "Total Discounts LBP",
      "Final Total USD",
      "Final Total LBP",
      "Payment Method",
      "Payment Currency",
      "Amount Paid USD",
      "Amount Paid LBP",
      "Cashier",
      "Status",
    ].join(",");

    const rows = sales.map((sale) => {
      const itemDiscounts = sale.totalItemDiscounts || { usd: 0, lbp: 0 };
      const saleDiscount = sale.saleDiscount?.amount || { usd: 0, lbp: 0 };
      const totalDiscounts = {
        usd: itemDiscounts.usd + saleDiscount.usd,
        lbp: itemDiscounts.lbp + saleDiscount.lbp,
      };

      return [
        sale.invoiceNumber,
        sale.createdAt.toISOString(),
        sale.customer ? (sale.customer as any).name : "Walk-in",
        sale.subtotalBeforeDiscount?.usd || 0,
        sale.subtotalBeforeDiscount?.lbp || 0,
        itemDiscounts.usd,
        itemDiscounts.lbp,
        saleDiscount.usd,
        saleDiscount.lbp,
        sale.saleDiscount?.discountName || "",
        totalDiscounts.usd,
        totalDiscounts.lbp,
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

  async getDailyGamingReport(date: Date) {
    const dayStart = new Date(date);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(date);
    dayEnd.setHours(23, 59, 59, 999);

    const revenue = await this.getGamingRevenue(dayStart, dayEnd);

    const hourlyBreakdown = await GamingSession.aggregate([
      {
        $match: {
          startTime: { $gte: dayStart, $lte: dayEnd },
          status: SessionStatus.COMPLETED,
          paymentStatus: SessionPaymentStatus.PAID,
        },
      },
      {
        $group: {
          _id: {
            $hour: "$startTime",
          },
          totalSessions: { $sum: 1 },
          totalUsd: {
            $sum: { $ifNull: ["$finalAmount.usd", "$totalCost.usd"] },
          },
          totalLbp: {
            $sum: { $ifNull: ["$finalAmount.lbp", "$totalCost.lbp"] },
          },
          totalDiscountsUsd: {
            $sum: { $ifNull: ["$discount.amount.usd", 0] },
          },
          totalDiscountsLbp: {
            $sum: { $ifNull: ["$discount.amount.lbp", 0] },
          },
          totalDuration: { $sum: "$duration" },
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
        totalSessions: hour.totalSessions,
        revenue: { usd: hour.totalUsd, lbp: hour.totalLbp },
        discounts: { usd: hour.totalDiscountsUsd, lbp: hour.totalDiscountsLbp },
        totalDuration: hour.totalDuration,
      })),
    };
  }

  async getMonthlyGamingReport(month: number, year: number) {
    const startDate = new Date(year, month - 1, 1);
    startDate.setHours(0, 0, 0, 0);
    const endDate = new Date(year, month, 0);
    endDate.setHours(23, 59, 59, 999);

    const revenue = await this.getGamingRevenue(startDate, endDate);

    const dailyBreakdown = await GamingSession.aggregate([
      {
        $match: {
          startTime: { $gte: startDate, $lte: endDate },
          status: SessionStatus.COMPLETED,
          paymentStatus: SessionPaymentStatus.PAID,
        },
      },
      {
        $group: {
          _id: {
            $dateToString: { format: "%Y-%m-%d", date: "$startTime" },
          },
          totalSessions: { $sum: 1 },
          totalUsd: {
            $sum: { $ifNull: ["$finalAmount.usd", "$totalCost.usd"] },
          },
          totalLbp: {
            $sum: { $ifNull: ["$finalAmount.lbp", "$totalCost.lbp"] },
          },
          totalDiscountsUsd: {
            $sum: { $ifNull: ["$discount.amount.usd", 0] },
          },
          totalDiscountsLbp: {
            $sum: { $ifNull: ["$discount.amount.lbp", 0] },
          },
          totalDuration: { $sum: "$duration" },
        },
      },
      {
        $sort: { _id: 1 },
      },
    ]);

    return {
      period: {
        type: "monthly",
        month,
        year,
        startDate,
        endDate,
      },
      revenue,
      dailyBreakdown: dailyBreakdown.map((day) => ({
        date: day._id,
        totalSessions: day.totalSessions,
        revenue: { usd: day.totalUsd, lbp: day.totalLbp },
        discounts: { usd: day.totalDiscountsUsd, lbp: day.totalDiscountsLbp },
        totalDuration: day.totalDuration,
      })),
    };
  }

  async getGamingRevenue(
    startDate: Date,
    endDate: Date
  ): Promise<{
    totalRevenue: { usd: number; lbp: number };
    totalSessions: number;
    averageSessionDuration: number;
    averageRevenue: { usd: number; lbp: number };
    totalDiscounts: { usd: number; lbp: number };
    revenueBeforeDiscounts: { usd: number; lbp: number };
  }> {
    const sessions = await GamingSession.find({
      startTime: { $gte: startDate, $lte: endDate },
      status: SessionStatus.COMPLETED,
      paymentStatus: SessionPaymentStatus.PAID,
    });

    const totalRevenue = sessions.reduce(
      (acc, session) => ({
        usd: acc.usd + (session.finalAmount?.usd || session.totalCost?.usd || 0),
        lbp: acc.lbp + (session.finalAmount?.lbp || session.totalCost?.lbp || 0),
      }),
      { usd: 0, lbp: 0 }
    );

    const totalDiscounts = sessions.reduce(
      (acc, session) => ({
        usd: acc.usd + (session.discount?.amount.usd || 0),
        lbp: acc.lbp + (session.discount?.amount.lbp || 0),
      }),
      { usd: 0, lbp: 0 }
    );

    const revenueBeforeDiscounts = {
      usd: totalRevenue.usd + totalDiscounts.usd,
      lbp: totalRevenue.lbp + totalDiscounts.lbp,
    };

    const totalSessions = sessions.length;
    const averageSessionDuration =
      totalSessions > 0
        ? sessions.reduce((acc, s) => acc + (s.duration || 0), 0) /
          totalSessions
        : 0;

    return {
      totalRevenue,
      totalSessions,
      averageSessionDuration,
      averageRevenue: {
        usd: totalSessions > 0 ? totalRevenue.usd / totalSessions : 0,
        lbp: totalSessions > 0 ? totalRevenue.lbp / totalSessions : 0,
      },
      totalDiscounts,
      revenueBeforeDiscounts,
    };
  }

  async getGamingRevenueByPC(
    startDate?: Date,
    endDate?: Date
  ): Promise<
    Array<{
      pcId: string;
      pcNumber: string;
      pcName: string;
      totalSessions: number;
      totalRevenue: { usd: number; lbp: number };
      averageDuration: number;
    }>
  > {
    const matchQuery: any = {
      status: SessionStatus.COMPLETED,
      paymentStatus: SessionPaymentStatus.PAID,
    };

    if (startDate && endDate) {
      matchQuery.startTime = { $gte: startDate, $lte: endDate };
    }

    const results = await GamingSession.aggregate([
      { $match: matchQuery },
      {
        $lookup: {
          from: "pcs",
          localField: "pc",
          foreignField: "_id",
          as: "pcInfo",
        },
      },
      { $unwind: "$pcInfo" },
      {
        $group: {
          _id: "$pc",
          pcNumber: { $first: "$pcInfo.pcNumber" },
          pcName: { $first: "$pcInfo.name" },
          totalSessions: { $sum: 1 },
          totalRevenueUsd: {
            $sum: { $ifNull: ["$finalAmount.usd", "$totalCost.usd"] },
          },
          totalRevenueLbp: {
            $sum: { $ifNull: ["$finalAmount.lbp", "$totalCost.lbp"] },
          },
          totalDiscountsUsd: { $sum: { $ifNull: ["$discount.amount.usd", 0] } },
          totalDiscountsLbp: { $sum: { $ifNull: ["$discount.amount.lbp", 0] } },
          averageDuration: { $avg: "$duration" },
        },
      },
      { $sort: { totalRevenueUsd: -1 } },
    ]);

    return results.map((pc) => ({
      pcId: pc._id.toString(),
      pcNumber: pc.pcNumber,
      pcName: pc.pcName,
      totalSessions: pc.totalSessions,
      totalRevenue: {
        usd: pc.totalRevenueUsd || 0,
        lbp: pc.totalRevenueLbp || 0,
      },
      totalDiscounts: {
        usd: pc.totalDiscountsUsd || 0,
        lbp: pc.totalDiscountsLbp || 0,
      },
      averageDuration: Math.round(pc.averageDuration || 0),
    }));
  }

  async getDiscountUsageReport(
    startDate?: Date,
    endDate?: Date
  ): Promise<
    Array<{
      discountId: string;
      discountName: string;
      discountPercentage: number;
      timesUsed: number;
      totalDiscountAmount: { usd: number; lbp: number };
      revenueImpact: { usd: number; lbp: number };
    }>
  > {
    const matchQuery: any = {
      status: SaleStatus.PAID,
    };

    if (startDate && endDate) {
      matchQuery.createdAt = { $gte: startDate, $lte: endDate };
    }

    // Get item-level discounts
    const itemDiscounts = await Sale.aggregate([
      { $match: matchQuery },
      { $unwind: "$items" },
      {
        $match: {
          "items.discount": { $exists: true, $ne: null },
        },
      },
      {
        $group: {
          _id: "$items.discount.discountId",
          discountName: { $first: "$items.discount.discountName" },
          discountPercentage: { $first: "$items.discount.percentage" },
          timesUsed: { $sum: 1 },
          totalDiscountUsd: { $sum: "$items.discount.amount.usd" },
          totalDiscountLbp: { $sum: "$items.discount.amount.lbp" },
          revenueBeforeDiscountUsd: { $sum: "$items.subtotal.usd" },
          revenueBeforeDiscountLbp: { $sum: "$items.subtotal.lbp" },
        },
      },
    ]);

    // Get sale-level discounts
    const saleDiscounts = await Sale.aggregate([
      { $match: matchQuery },
      {
        $match: {
          saleDiscount: { $exists: true, $ne: null },
        },
      },
      {
        $group: {
          _id: "$saleDiscount.discountId",
          discountName: { $first: "$saleDiscount.discountName" },
          discountPercentage: { $first: "$saleDiscount.percentage" },
          timesUsed: { $sum: 1 },
          totalDiscountUsd: { $sum: "$saleDiscount.amount.usd" },
          totalDiscountLbp: { $sum: "$saleDiscount.amount.lbp" },
          revenueBeforeDiscountUsd: {
            $sum: {
              $add: ["$totals.usd", "$saleDiscount.amount.usd"],
            },
          },
          revenueBeforeDiscountLbp: {
            $sum: {
              $add: ["$totals.lbp", "$saleDiscount.amount.lbp"],
            },
          },
        },
      },
    ]);

    // Combine and deduplicate
    const allDiscounts = [...itemDiscounts, ...saleDiscounts];
    const discountMap = new Map();

    allDiscounts.forEach((discount) => {
      const id = discount._id.toString();
      if (discountMap.has(id)) {
        const existing = discountMap.get(id);
        existing.timesUsed += discount.timesUsed;
        existing.totalDiscountAmount.usd += discount.totalDiscountUsd;
        existing.totalDiscountAmount.lbp += discount.totalDiscountLbp;
        existing.revenueImpact.usd += discount.revenueBeforeDiscountUsd;
        existing.revenueImpact.lbp += discount.revenueBeforeDiscountLbp;
      } else {
        discountMap.set(id, {
          discountId: id,
          discountName: discount.discountName,
          discountPercentage: discount.discountPercentage,
          timesUsed: discount.timesUsed,
          totalDiscountAmount: {
            usd: discount.totalDiscountUsd,
            lbp: discount.totalDiscountLbp,
          },
          revenueImpact: {
            usd: discount.revenueBeforeDiscountUsd,
            lbp: discount.revenueBeforeDiscountLbp,
          },
        });
      }
    });

    return Array.from(discountMap.values()).sort(
      (a, b) => b.totalDiscountAmount.usd - a.totalDiscountAmount.usd
    );
  }

  async getCustomerDiscountReport(
    customerId?: string,
    startDate?: Date,
    endDate?: Date
  ): Promise<
    Array<{
      customerId: string;
      customerName: string;
      totalPurchases: number;
      totalSpent: { usd: number; lbp: number };
      totalDiscountsReceived: { usd: number; lbp: number };
      amountSaved: { usd: number; lbp: number };
    }>
  > {
    const matchQuery: any = {
      status: SaleStatus.PAID,
      customer: { $exists: true, $ne: null },
    };

    if (customerId) {
      matchQuery.customer = customerId;
    }

    if (startDate && endDate) {
      matchQuery.createdAt = { $gte: startDate, $lte: endDate };
    }

    const results = await Sale.aggregate([
      { $match: matchQuery },
      {
        $lookup: {
          from: "customers",
          localField: "customer",
          foreignField: "_id",
          as: "customerInfo",
        },
      },
      { $unwind: "$customerInfo" },
      {
        $group: {
          _id: "$customer",
          customerName: { $first: "$customerInfo.name" },
          totalPurchases: { $sum: 1 },
          totalSpentUsd: { $sum: "$totals.usd" },
          totalSpentLbp: { $sum: "$totals.lbp" },
          totalItemDiscountsUsd: {
            $sum: { $ifNull: ["$totalItemDiscounts.usd", 0] },
          },
          totalItemDiscountsLbp: {
            $sum: { $ifNull: ["$totalItemDiscounts.lbp", 0] },
          },
          totalSaleDiscountsUsd: {
            $sum: { $ifNull: ["$saleDiscount.amount.usd", 0] },
          },
          totalSaleDiscountsLbp: {
            $sum: { $ifNull: ["$saleDiscount.amount.lbp", 0] },
          },
        },
      },
      {
        $sort: { totalSpentUsd: -1 },
      },
    ]);

    return results.map((customer) => ({
      customerId: customer._id.toString(),
      customerName: customer.customerName,
      totalPurchases: customer.totalPurchases,
      totalSpent: {
        usd: customer.totalSpentUsd,
        lbp: customer.totalSpentLbp,
      },
      totalDiscountsReceived: {
        usd: customer.totalItemDiscountsUsd + customer.totalSaleDiscountsUsd,
        lbp: customer.totalItemDiscountsLbp + customer.totalSaleDiscountsLbp,
      },
      amountSaved: {
        usd: customer.totalItemDiscountsUsd + customer.totalSaleDiscountsUsd,
        lbp: customer.totalItemDiscountsLbp + customer.totalSaleDiscountsLbp,
      },
    }));
  }
}

export default new ReportService();
