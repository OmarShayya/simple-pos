import Sale, { SaleStatus, Currency } from "../models/sale.model";
import GamingSession, {
  SessionStatus,
  SessionPaymentStatus,
} from "../models/gamingsession.model";
import { Money, roundMoney, zeroMoney, addMoney } from "../utils/money";
import { localDateRange, locateBucket, ReportPeriod, resolvePeriod, ResolvedPeriod } from "../utils/period";
import { localDateString, localHour } from "../utils/time";
import { getLoungeTimezone } from "./loungeSettings";
import { isGamingLine } from "./orders/orderLines";
import { LedgerEntry, loadLedger } from "./reports/revenueLedger";
import { average, revenueTotals } from "./reports/ledgerAggregates";

/**
 * Older report endpoints (still used by older POS builds). Their headline numbers now come from the
 * same revenue ledger as GET /reports/summary: paid orders by payment time, lounge timezone,
 * sessions counted once. New clients should use the summary report.
 */
interface RevenueBreakdown {
  total: Money;
  products: Money;
  gaming: Money;
  usdPayments: Money;
  lbpPayments: Money;
  totalSales: number;
  productSales: number;
  gamingSales: number;
  averageSale: Money;
  discounts: {
    totalItemDiscounts: Money;
    totalSaleDiscounts: Money;
    totalDiscounts: Money;
    revenueBeforeDiscounts: Money;
  };
}

const sumBy = (entries: LedgerEntry[], pick: (e: LedgerEntry) => Money): Money =>
  roundMoney(entries.reduce((acc, e) => addMoney(acc, pick(e)), zeroMoney()));

const paidIn = (entries: LedgerEntry[], currency: Currency) =>
  sumBy(entries.filter((e) => e.paymentCurrency === currency), (e) => e.amountPaid);

const toBreakdown = (entries: LedgerEntry[]): RevenueBreakdown => {
  const totals = revenueTotals(entries);
  const itemDiscounts = sumBy(entries, (e) => e.itemDiscounts);
  const saleDiscounts = sumBy(entries, (e) => e.orderDiscount);
  return {
    total: totals.revenue,
    products: totals.products,
    gaming: totals.gaming,
    usdPayments: paidIn(entries, Currency.USD),
    lbpPayments: paidIn(entries, Currency.LBP),
    totalSales: totals.orders,
    productSales: entries.filter((e) => e.lines.some((l) => l.kind === "product")).length,
    gamingSales: entries.filter((e) => e.lines.some((l) => l.kind === "gaming")).length,
    averageSale: average(totals.revenue, totals.orders),
    discounts: {
      totalItemDiscounts: itemDiscounts,
      totalSaleDiscounts: saleDiscounts,
      totalDiscounts: totals.discounts,
      revenueBeforeDiscounts: roundMoney(addMoney(totals.revenue, totals.discounts)),
    },
  };
};

/** Groups ledger entries into a period's buckets with the legacy row shape. */
const bucketRows = (entries: LedgerEntry[], period: ResolvedPeriod) => {
  const rows = period.buckets.map((b) => ({ key: b.key, entries: [] as LedgerEntry[] }));
  for (const e of entries) {
    const i = locateBucket(period.buckets, e.at);
    if (i >= 0) rows[i].entries.push(e);
  }
  return rows.filter((r) => r.entries.length);
};

const pad = (n: number) => String(n).padStart(2, "0");

const dayOf = (value: Date | string | undefined): string | undefined =>
  value === undefined ? undefined : typeof value === "string" ? value.slice(0, 10) : value.toISOString().slice(0, 10);

class ReportService {
  /** [start of `from`, end of `to`] in the lounge timezone; missing days default to today. */
  private async localDays(from?: Date | string, to?: Date | string) {
    const tz = await getLoungeTimezone();
    const today = localDateString(new Date(), tz);
    const first = dayOf(from) ?? today;
    const last = dayOf(to) ?? dayOf(from) ?? today;
    const { start, end } = localDateRange(tz, first, last);
    return { tz, start: start!, end: new Date(end!.getTime() - 1) };
  }

  /** Lounge-local day range for optional YYYY-MM-DD bounds (undefined when neither is given). */
  async dayRange(from?: string, to?: string): Promise<{ start: Date; end: Date } | undefined> {
    if (!from && !to) return undefined;
    const { start, end } = await this.localDays(from ?? to, to ?? from);
    return { start, end };
  }

  private async periodLedger(period: ReportPeriod, date: string) {
    const tz = await getLoungeTimezone();
    const resolved = resolvePeriod(period, date, tz);
    return { tz, resolved, entries: await loadLedger(resolved.range) };
  }

  private paymentSplit(entries: LedgerEntry[]) {
    return {
      total: sumBy(entries, (e) => e.amountPaid),
      usdPayments: paidIn(entries, Currency.USD).usd,
      lbpPayments: paidIn(entries, Currency.LBP).lbp,
    };
  }

  async getDailyReport(date: Date | string) {
    const day = typeof date === "string" ? date.slice(0, 10) : date.toISOString().slice(0, 10);
    const { tz, resolved, entries } = await this.periodLedger("day", day);

    const byHour = new Map<number, LedgerEntry[]>();
    for (const e of entries) {
      const hour = localHour(e.at, tz);
      byHour.set(hour, [...(byHour.get(hour) ?? []), e]);
    }

    return {
      period: { type: "daily", date: resolved.range.start, timezone: tz },
      revenue: toBreakdown(entries),
      hourlyBreakdown: [...byHour.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([hour, list]) => ({ hour, totalSales: list.length, revenue: sumBy(list, (e) => e.amountPaid) })),
    };
  }

  async getWeeklyReport(week: number, month: number, year: number) {
    // "Week N of the month": the week (Monday–Sunday) containing day 1 + 7·(N−1)
    const anchor = new Date(Date.UTC(year, month - 1, 1 + (week - 1) * 7)).toISOString().slice(0, 10);
    const { tz, resolved, entries } = await this.periodLedger("week", anchor);
    return {
      period: {
        type: "weekly",
        week,
        month,
        year,
        startDate: resolved.range.start,
        endDate: new Date(resolved.range.end.getTime() - 1),
        timezone: tz,
      },
      revenue: toBreakdown(entries),
      dailyBreakdown: this.dailyBreakdown(entries, resolved),
    };
  }

  async getMonthlyReport(month: number, year: number) {
    const { tz, resolved, entries } = await this.periodLedger("month", `${year}-${pad(month)}-01`);
    const weeks = new Map<string, LedgerEntry[]>();
    for (const e of entries) {
      const weekStart = resolvePeriod("week", localDateString(e.at, tz), tz).range.firstDay;
      weeks.set(weekStart, [...(weeks.get(weekStart) ?? []), e]);
    }
    return {
      period: {
        type: "monthly",
        month,
        year,
        startDate: resolved.range.start,
        endDate: new Date(resolved.range.end.getTime() - 1),
        timezone: tz,
      },
      revenue: toBreakdown(entries),
      dailyBreakdown: this.dailyBreakdown(entries, resolved),
      weeklyBreakdown: [...weeks.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([weekStart, list]) => ({ week: weekStart, totalSales: list.length, revenue: sumBy(list, (e) => e.amountPaid) })),
    };
  }

  async getYearlyReport(year: number) {
    const { tz, resolved, entries } = await this.periodLedger("year", `${year}-01-01`);
    return {
      period: {
        type: "yearly",
        year,
        startDate: resolved.range.start,
        endDate: new Date(resolved.range.end.getTime() - 1),
        timezone: tz,
      },
      revenue: toBreakdown(entries),
      monthlyBreakdown: bucketRows(entries, resolved).map((row) => ({
        month: Number(row.key.slice(5, 7)),
        totalSales: row.entries.length,
        revenue: this.paymentSplit(row.entries),
      })),
    };
  }

  private dailyBreakdown(entries: LedgerEntry[], period: ResolvedPeriod) {
    return bucketRows(entries, period).map((row) => ({
      date: row.key,
      totalSales: row.entries.length,
      revenue: this.paymentSplit(row.entries),
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
      matchQuery.paidAt = { $gte: startDate, $lte: endDate };
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
          revenueBeforeDiscountUsd: { $sum: "$items.subtotal.usd" },
          revenueBeforeDiscountLbp: { $sum: "$items.subtotal.lbp" },
          totalDiscountsUsd: { $sum: { $ifNull: ["$items.discount.amount.usd", 0] } },
          totalDiscountsLbp: { $sum: { $ifNull: ["$items.discount.amount.lbp", 0] } },
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
      revenueBeforeDiscount: { usd: cat.revenueBeforeDiscountUsd, lbp: cat.revenueBeforeDiscountLbp },
      totalDiscounts: { usd: cat.totalDiscountsUsd, lbp: cat.totalDiscountsLbp },
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
      matchQuery.paidAt = { $gte: startDate, $lte: endDate };
    }

    const pipeline: any[] = [
      { $match: matchQuery },
      { $unwind: "$items" },
      { $match: { "items.kind": { $ne: "gaming" }, "items.product": { $ne: null } } },
    ];

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
          revenueBeforeDiscountUsd: { $sum: "$items.subtotal.usd" },
          revenueBeforeDiscountLbp: { $sum: "$items.subtotal.lbp" },
          totalDiscountsUsd: { $sum: { $ifNull: ["$items.discount.amount.usd", 0] } },
          totalDiscountsLbp: { $sum: { $ifNull: ["$items.discount.amount.lbp", 0] } },
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
      productId: prod._id ? prod._id.toString() : null,
      productName: prod.productName,
      productSku: prod.productSku,
      totalQuantitySold: prod.totalQuantity,
      revenueBeforeDiscount: { usd: prod.revenueBeforeDiscountUsd, lbp: prod.revenueBeforeDiscountLbp },
      totalDiscounts: { usd: prod.totalDiscountsUsd, lbp: prod.totalDiscountsLbp },
      totalRevenue: {
        usd: prod.totalRevenueUsd,
        lbp: prod.totalRevenueLbp,
      },
      salesCount: prod.salesCount,
    }));
  }

  async getDailyTransactions(
    date?: string,
    startDate?: string,
    endDate?: string,
    page: number = 1,
    limit: number = 50
  ) {
    let query: any = {
      status: { $ne: SaleStatus.CANCELLED },
    };

    const days = startDate && endDate ? await this.localDays(startDate, endDate) : await this.localDays(date);
    query.createdAt = { $gte: days.start, $lte: days.end };

    const skip = (page - 1) * limit;

    const [transactions, total] = await Promise.all([
      Sale.find(query)
        .populate("customer", "name phone")
        .populate("cashier", "name")
        .populate("items.product", "name sku category")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      Sale.countDocuments(query),
    ]);

    // Get all sale IDs to fetch linked gaming sessions (only billable ones)
    const saleIds = transactions.map((t) => t._id);
    const gamingSessions = await GamingSession.find({
      sale: { $in: saleIds },
      isBillable: { $ne: false }, // Exclude non-billable sessions
    })
      .populate("pc", "pcNumber name")
      .populate("customer", "name phone");

    // Create a map of sale ID to gaming sessions
    const sessionsBySaleId = new Map<string, any[]>();
    gamingSessions.forEach((session) => {
      const saleId = session.sale?.toString();
      if (saleId) {
        if (!sessionsBySaleId.has(saleId)) {
          sessionsBySaleId.set(saleId, []);
        }
        sessionsBySaleId.get(saleId)!.push(session);
      }
    });

    return {
      transactions: transactions.map((sale) => {
        const saleId = sale._id.toString();
        const linkedSessions = sessionsBySaleId.get(saleId) || [];

        // Map items with full details and type categorization
        const items = sale.items.map((item) => {
          const isGaming = isGamingLine(item);
          const isGamingSession = isGaming;

          // Find linked gaming session for this item (if it's a session)
          let gamingSessionDetails = null;
          if (isGamingSession && linkedSessions.length > 0) {
            // Match by session number in SKU (e.g., SESSION-20251220-0001)
            const sessionNumber = item.productSku?.replace("SESSION-", "");
            const matchingSession = linkedSessions.find(
              (s) => s.sessionNumber === sessionNumber
            );
            if (matchingSession) {
              gamingSessionDetails = {
                sessionNumber: matchingSession.sessionNumber,
                pc: matchingSession.pc
                  ? {
                      pcNumber: (matchingSession.pc as any).pcNumber,
                      name: (matchingSession.pc as any).name,
                    }
                  : null,
                customerName: matchingSession.customerName,
                startTime: matchingSession.startTime,
                endTime: matchingSession.endTime,
                duration: matchingSession.duration,
                hourlyRate: matchingSession.hourlyRate,
                status: matchingSession.status,
              };
            }
          }

          return {
            productId: item.product?.toString(),
            productName: item.productName,
            productSku: item.productSku || null,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            subtotal: item.subtotal,
            discount: item.discount
              ? {
                  discountName: item.discount.discountName,
                  percentage: item.discount.percentage,
                  amount: item.discount.amount,
                }
              : null,
            finalAmount: item.finalAmount,
            type: isGaming ? "gaming" : "product",
            isGamingSession,
            gamingSessionDetails,
          };
        });

        // Summary counts
        const productItems = items.filter((i) => i.type === "product");
        const gamingItems = items.filter((i) => i.type === "gaming");

        return {
          id: saleId,
          invoiceNumber: sale.invoiceNumber,
          customer: sale.customer
            ? {
                name: (sale.customer as any).name,
                phone: (sale.customer as any).phone,
              }
            : null,
          items,
          itemsSummary: {
            totalItems: items.length,
            productCount: productItems.length,
            gamingCount: gamingItems.length,
            productTotal: {
              usd: productItems.reduce((sum, i) => sum + i.finalAmount.usd, 0),
              lbp: productItems.reduce((sum, i) => sum + i.finalAmount.lbp, 0),
            },
            gamingTotal: {
              usd: gamingItems.reduce((sum, i) => sum + i.finalAmount.usd, 0),
              lbp: gamingItems.reduce((sum, i) => sum + i.finalAmount.lbp, 0),
            },
          },
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
          cashier: (sale.cashier as any)?.name ?? null,
          source: sale.source ?? "pos",
          createdAt: sale.createdAt,
          notes: sale.notes || null,
        };
      }),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async exportToCSV(type: string, startDate: Date, endDate: Date) {
    const sales = await Sale.find({
      paidAt: { $gte: startDate, $lte: endDate },
      status: SaleStatus.PAID,
    })
      .populate("customer", "name phone")
      .populate("cashier", "name")
      .sort({ paidAt: 1 });

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
        (sale.cashier as any)?.name ?? "",
        sale.status,
      ].join(",");
    });

    return [headers, ...rows].join("\n");
  }

  async getDailyGamingReport(date?: string) {
    const { tz, start: dayStart, end: dayEnd } = await this.localDays(date);

    const revenue = await this.getGamingRevenue(dayStart, dayEnd);

    const hourlyBreakdown = await GamingSession.aggregate([
      {
        $match: {
          startTime: { $gte: dayStart, $lte: dayEnd },
          status: SessionStatus.COMPLETED,
          paymentStatus: SessionPaymentStatus.PAID,
          isBillable: { $ne: false }, // Exclude non-billable sessions
        },
      },
      {
        $group: {
          _id: {
            $hour: { date: "$startTime", timezone: tz },
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
        timezone: tz,
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

  async getMonthlyGamingReport(month?: number, year?: number) {
    const tz = await getLoungeTimezone();
    const [ty, tm] = localDateString(new Date(), tz).split("-").map(Number);
    year = year || ty;
    month = month || tm;
    const { range } = resolvePeriod("month", `${year}-${pad(month)}-01`, tz);
    const startDate = range.start;
    const endDate = new Date(range.end.getTime() - 1);

    const revenue = await this.getGamingRevenue(startDate, endDate);

    const dailyBreakdown = await GamingSession.aggregate([
      {
        $match: {
          startTime: { $gte: startDate, $lte: endDate },
          status: SessionStatus.COMPLETED,
          paymentStatus: SessionPaymentStatus.PAID,
          isBillable: { $ne: false }, // Exclude non-billable sessions
        },
      },
      {
        $group: {
          _id: {
            $dateToString: { format: "%Y-%m-%d", date: "$startTime", timezone: tz },
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
    // Only include billable sessions in reports
    const sessions = await GamingSession.find({
      startTime: { $gte: startDate, $lte: endDate },
      status: SessionStatus.COMPLETED,
      paymentStatus: SessionPaymentStatus.PAID,
      isBillable: { $ne: false }, // Exclude non-billable sessions
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

  /** Gaming-session revenue for lounge-local days (default: today). */
  async getGamingRevenueForDays(from?: string, to?: string) {
    const { start, end } = await this.localDays(from, to);
    return this.getGamingRevenue(start, end);
  }

  async getGamingRevenueByPCForDays(from?: string, to?: string) {
    if (!from && !to) return this.getGamingRevenueByPC();
    const { start, end } = await this.localDays(from, to);
    return this.getGamingRevenueByPC(start, end);
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
      isBillable: { $ne: false }, // Exclude non-billable sessions
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
      matchQuery.paidAt = { $gte: startDate, $lte: endDate };
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
      matchQuery.paidAt = { $gte: startDate, $lte: endDate };
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
