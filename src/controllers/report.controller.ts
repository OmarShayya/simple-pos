import { Response, NextFunction } from "express";
import { CustomRequest } from "../types";
import reportService from "../services/report.service";
import { ApiResponseUtil } from "../utils/apiResponse";
import { ApiError } from "../utils/apiError";

class ReportController {
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
    const { categoryId, startDate, endDate } = req.query;

    const start = startDate ? new Date(startDate as string) : undefined;
    const end = endDate ? new Date(endDate as string) : undefined;

    const report = await reportService.getSalesByCategory(
      categoryId as string | undefined,
      start,
      end
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
    const { productId, startDate, endDate } = req.query;

    const start = startDate ? new Date(startDate as string) : undefined;
    const end = endDate ? new Date(endDate as string) : undefined;

    const report = await reportService.getSalesByProduct(
      productId as string | undefined,
      start,
      end
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

    const reportDate = date ? new Date(date as string) : new Date();
    const start = startDate ? new Date(startDate as string) : undefined;
    const end = endDate ? new Date(endDate as string) : undefined;

    const result = await reportService.getDailyTransactions(
      reportDate,
      start,
      end,
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

    const csv = await reportService.exportToCSV(
      type as string,
      new Date(startDate as string),
      new Date(endDate as string)
    );

    res.setHeader("Content-Type", "text/csv");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=report-${type}-${Date.now()}.csv`
    );
    return res.send(csv);
  }
}

export default new ReportController();
