import { Router } from "express";
import dashboardController from "../controllers/dashboard.controller";
import { asyncHandler } from "../middlewares/asyncHandler";
import { authenticate, authorize } from "../middlewares/auth.middleware";
import { UserRole } from "../models/user.model";

const router = Router();

router.get(
  "/overview",
  authenticate,
  authorize(UserRole.ADMIN, UserRole.MANAGER),
  asyncHandler(dashboardController.getOverallStats)
);

router.get(
  "/today",
  authenticate,
  asyncHandler(dashboardController.getTodayStats)
);

router.get(
  "/daily-sales",
  authenticate,
  authorize(UserRole.ADMIN, UserRole.MANAGER),
  asyncHandler(dashboardController.getDailySales)
);

router.get(
  "/weekly",
  authenticate,
  authorize(UserRole.ADMIN, UserRole.MANAGER),
  asyncHandler(dashboardController.getWeeklyStats)
);

router.get(
  "/monthly",
  authenticate,
  authorize(UserRole.ADMIN, UserRole.MANAGER),
  asyncHandler(dashboardController.getMonthlyStats)
);

router.get(
  "/date-range",
  authenticate,
  authorize(UserRole.ADMIN, UserRole.MANAGER),
  asyncHandler(dashboardController.getCustomDateRangeStats)
);

router.get(
  "/top-products",
  authenticate,
  asyncHandler(dashboardController.getTopSellingProducts)
);

router.get(
  "/low-stock",
  authenticate,
  asyncHandler(dashboardController.getLowStockProducts)
);

router.get(
  "/customers",
  authenticate,
  authorize(UserRole.ADMIN, UserRole.MANAGER),
  asyncHandler(dashboardController.getCustomerStats)
);

router.get(
  "/cashier-performance",
  authenticate,
  authorize(UserRole.ADMIN, UserRole.MANAGER),
  asyncHandler(dashboardController.getCashierPerformance)
);

router.get(
  "/pending-sales",
  authenticate,
  authorize(UserRole.ADMIN, UserRole.MANAGER),
  asyncHandler(dashboardController.getPendingSalesValue)
);

router.get(
  "/inventory-value",
  authenticate,
  authorize(UserRole.ADMIN, UserRole.MANAGER),
  asyncHandler(dashboardController.getInventoryValue)
);

export default router;
