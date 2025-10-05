import { Response, NextFunction } from "express";
import { CustomRequest } from "../types";
import dashboardService from "../services/dashboard.service";
import { ApiResponseUtil } from "../utils/apiResponse";
import { ApiError } from "../utils/apiError";

class DashboardController {
  async getTodayStats(req: CustomRequest, res: Response, next: NextFunction) {
    const stats = await dashboardService.getTodayStats();
    return ApiResponseUtil.success(
      res,
      stats,
      "Today stats retrieved successfully"
    );
  }

  async getDailySales(req: CustomRequest, res: Response, next: NextFunction) {
    const { startDate, endDate } = req.query;

    if (!startDate || !endDate) {
      throw ApiError.badRequest("startDate and endDate are required");
    }

    const start = new Date(startDate as string);
    const end = new Date(endDate as string);

    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      throw ApiError.badRequest("Invalid date format");
    }

    const dailySales = await dashboardService.getDailySales(start, end);
    return ApiResponseUtil.success(
      res,
      dailySales,
      "Daily sales retrieved successfully"
    );
  }

  async getWeeklyStats(req: CustomRequest, res: Response, next: NextFunction) {
    const stats = await dashboardService.getWeeklyStats();
    return ApiResponseUtil.success(
      res,
      stats,
      "Weekly stats retrieved successfully"
    );
  }

  async getMonthlyStats(req: CustomRequest, res: Response, next: NextFunction) {
    const stats = await dashboardService.getMonthlyStats();
    return ApiResponseUtil.success(
      res,
      stats,
      "Monthly stats retrieved successfully"
    );
  }

  async getCustomDateRangeStats(
    req: CustomRequest,
    res: Response,
    next: NextFunction
  ) {
    const { startDate, endDate } = req.query;

    if (!startDate || !endDate) {
      throw ApiError.badRequest("startDate and endDate are required");
    }

    const start = new Date(startDate as string);
    const end = new Date(endDate as string);

    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      throw ApiError.badRequest("Invalid date format");
    }

    const stats = await dashboardService.getCustomDateRangeStats(start, end);
    return ApiResponseUtil.success(
      res,
      stats,
      "Custom date range stats retrieved successfully"
    );
  }

  async getTopSellingProducts(
    req: CustomRequest,
    res: Response,
    next: NextFunction
  ) {
    const limit = req.query.limit ? Number(req.query.limit) : 10;
    const products = await dashboardService.getTopSellingProducts(limit);
    return ApiResponseUtil.success(
      res,
      products,
      "Top selling products retrieved successfully"
    );
  }

  async getLowStockProducts(
    req: CustomRequest,
    res: Response,
    next: NextFunction
  ) {
    const products = await dashboardService.getLowStockProducts();
    return ApiResponseUtil.success(
      res,
      products,
      "Low stock products retrieved successfully"
    );
  }

  async getCustomerStats(
    req: CustomRequest,
    res: Response,
    next: NextFunction
  ) {
    const stats = await dashboardService.getCustomerStats();
    return ApiResponseUtil.success(
      res,
      stats,
      "Customer stats retrieved successfully"
    );
  }

  async getCashierPerformance(
    req: CustomRequest,
    res: Response,
    next: NextFunction
  ) {
    const { startDate, endDate } = req.query;

    const start = startDate ? new Date(startDate as string) : undefined;
    const end = endDate ? new Date(endDate as string) : undefined;

    if ((start && isNaN(start.getTime())) || (end && isNaN(end.getTime()))) {
      throw ApiError.badRequest("Invalid date format");
    }

    const performance = await dashboardService.getCashierPerformance(
      start,
      end
    );
    return ApiResponseUtil.success(
      res,
      performance,
      "Cashier performance retrieved successfully"
    );
  }

  async getPendingSalesValue(
    req: CustomRequest,
    res: Response,
    next: NextFunction
  ) {
    const data = await dashboardService.getPendingSalesValue();
    return ApiResponseUtil.success(
      res,
      data,
      "Pending sales value retrieved successfully"
    );
  }

  async getInventoryValue(
    req: CustomRequest,
    res: Response,
    next: NextFunction
  ) {
    const data = await dashboardService.getInventoryValue();
    return ApiResponseUtil.success(
      res,
      data,
      "Inventory value retrieved successfully"
    );
  }

  async getOverallStats(req: CustomRequest, res: Response, next: NextFunction) {
    const stats = await dashboardService.getOverallStats();
    return ApiResponseUtil.success(
      res,
      stats,
      "Overall dashboard stats retrieved successfully"
    );
  }
}

export default new DashboardController();
