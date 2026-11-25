import { Response, NextFunction } from "express";
import { CustomRequest } from "../types";
import reportService from "../services/report.service";
import { ApiResponseUtil } from "../utils/apiResponse";
import { ApiError } from "../utils/apiError";
import summaryReportService from "../services/reports/summaryReport.service";
import { ReportSummaryQueryDto } from "../dtos/report.dto";
import { isDateString } from "../utils/time";

/** A YYYY-MM-DD query value (lounge-local day), or undefined. */
const queryDay = (value: unknown): string | undefined => {
  if (value === undefined || value === "") return undefined;
  const day = String(value).slice(0, 10);
  if (!isDateString(day)) throw ApiError.badRequest("Dates must be written as YYYY-MM-DD");
  return day;
};

class ReportController {
  /** Day / week / month / year summary (lounge timezone, paid orders = revenue). */
  async getSummary(req: CustomRequest, res: Response, _next: NextFunction) {
    const q = res.locals.query as ReportSummaryQueryDto;
    const report = await summaryReportService.getSummary(q.period, q.date);
    return ApiResponseUtil.success(res, report, "Report retrieved successfully");
  }

  async getDailyReport(req: CustomRequest, res: Response, next: NextFunction) {
    const { date } = req.query;

    if (!date) {
      throw ApiError.badRequest("Date is required");
    }

    const reportDate = new Date(date as string);

    if (isNaN(reportDate.getTime())) {
      throw ApiError.badRequest("Invalid date format");
    }

    const report = await reportService.getDailyReport(reportDate);

    return ApiResponseUtil.success(
      res,
      report,
      "Daily report retrieved successfully"
    );
  }

  async getWeeklyReport(req: CustomRequest, res: Response, next: NextFunction) {
    const { week, month, year } = req.query;

    if (!week || !month || !year) {
      throw ApiError.badRequest("Week, month, and year are required");
    }

    const report = await reportService.getWeeklyReport(
      Number(week),
      Number(month),
      Number(year)
    );

    return ApiResponseUtil.success(
      res,
      report,
      "Weekly report retrieved successfully"
    );
  }

  async getMonthlyReport(
    req: CustomRequest,
    res: Response,
    next: NextFunction
  ) {
    const { month, year } = req.query;

    if (!month || !year) {
      throw ApiError.badRequest("Month and year are required");
    }

    const report = await reportService.getMonthlyReport(
      Number(month),
      Number(year)
    );

    return ApiResponseUtil.success(
      res,
      report,
      "Monthly report retrieved successfully"
    );
  }

  async getYearlyReport(req: CustomRequest, res: Response, next: NextFunction) {
    const { year } = req.query;

    if (!year) {
      throw ApiError.badRequest("Year is required");
    }

    const report = await reportService.getYearlyReport(Number(year));

    return ApiResponseUtil.success(
      res,
      report,
      "Yearly report retrieved successfully"
    );
  }

  async getSalesByCategory(
    req: CustomRequest,
    res: Response,
    next: NextFunction
  ) {
    const range = await reportService.dayRange(queryDay(req.query.startDate), queryDay(req.query.endDate));
    const report = await reportService.getSalesByCategory(
      req.query.categoryId as string | undefined,
      range?.start,
      range?.end
    );

    return ApiResponseUtil.success(
      res,
      report,
      "Category sales report retrieved successfully"
    );
  }

  async getSalesByProduct(
    req: CustomRequest,
    res: Response,
    next: NextFunction
  ) {
    const range = await reportService.dayRange(queryDay(req.query.startDate), queryDay(req.query.endDate));
    const report = await reportService.getSalesByProduct(
      req.query.productId as string | undefined,
      range?.start,
      range?.end
    );

    return ApiResponseUtil.success(
      res,
      report,
      "Product sales report retrieved successfully"
    );
  }

  async getDailyTransactions(
    req: CustomRequest,
    res: Response,
    next: NextFunction
  ) {
    const { date, startDate, endDate, page, limit } = req.query;

    const result = await reportService.getDailyTransactions(
      queryDay(date),
      queryDay(startDate),
      queryDay(endDate),
      Number(page) || 1,
      Number(limit) || 50
    );

    return ApiResponseUtil.paginated(
      res,
      result.transactions,
      result.page,
      result.limit,
      result.total,
      "Daily transactions retrieved successfully"
    );
  }

  async exportReport(req: CustomRequest, res: Response, next: NextFunction) {
    const { type, startDate, endDate } = req.query;

    if (!type || !startDate || !endDate) {
      throw ApiError.badRequest("Type, startDate, and endDate are required");
    }

    const range = (await reportService.dayRange(queryDay(startDate), queryDay(endDate)))!;
    const csv = await reportService.exportToCSV(type as string, range.start, range.end);

    res.setHeader("Content-Type", "text/csv");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=report-${type}-${Date.now()}.csv`
    );
    return res.send(csv);
  }

  async getGamingRevenue(
    req: CustomRequest,
    res: Response,
    next: NextFunction
  ) {
    const revenue = await reportService.getGamingRevenueForDays(queryDay(req.query.startDate), queryDay(req.query.endDate));

    return ApiResponseUtil.success(
      res,
      revenue,
      "Gaming revenue retrieved successfully"
    );
  }

  async getGamingRevenueByPC(
    req: CustomRequest,
    res: Response,
    next: NextFunction
  ) {
    const revenue = await reportService.getGamingRevenueByPCForDays(queryDay(req.query.startDate), queryDay(req.query.endDate));

    return ApiResponseUtil.success(
      res,
      revenue,
      "Gaming revenue by PC retrieved successfully"
    );
  }

  async getDailyGamingReport(
    req: CustomRequest,
    res: Response,
    next: NextFunction
  ) {
    const report = await reportService.getDailyGamingReport(queryDay(req.query.date));

    return ApiResponseUtil.success(
      res,
      report,
      "Daily gaming report retrieved successfully"
    );
  }

  async getMonthlyGamingReport(
    req: CustomRequest,
    res: Response,
    next: NextFunction
  ) {
    const month = Number(req.query.month) || undefined;
    const year = Number(req.query.year) || undefined;
    if ((month && (month < 1 || month > 12)) || (year && (year < 2000 || year > 2100))) {
      throw ApiError.badRequest("Invalid month or year");
    }

    const report = await reportService.getMonthlyGamingReport(month, year);

    return ApiResponseUtil.success(
      res,
      report,
      "Monthly gaming report retrieved successfully"
    );
  }
}

export default new ReportController();
