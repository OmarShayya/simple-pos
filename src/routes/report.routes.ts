import { Router } from "express";
import reportController from "../controllers/report.controller";
import { asyncHandler } from "../middlewares/asyncHandler";
import { authenticate, authorize } from "../middlewares/auth.middleware";
import { UserRole } from "../models/user.model";

const router = Router();

router.get(
  "/daily",
  authenticate,
  authorize(UserRole.ADMIN, UserRole.MANAGER),
  asyncHandler(reportController.getDailyReport)
);

router.get(
  "/weekly",
  authenticate,
  authorize(UserRole.ADMIN, UserRole.MANAGER),
  asyncHandler(reportController.getWeeklyReport)
);

router.get(
  "/monthly",
  authenticate,
  authorize(UserRole.ADMIN, UserRole.MANAGER),
  asyncHandler(reportController.getMonthlyReport)
);

router.get(
  "/yearly",
  authenticate,
  authorize(UserRole.ADMIN, UserRole.MANAGER),
  asyncHandler(reportController.getYearlyReport)
);

router.get(
  "/by-category",
  authenticate,
  authorize(UserRole.ADMIN, UserRole.MANAGER),
  asyncHandler(reportController.getSalesByCategory)
);

router.get(
  "/by-product",
  authenticate,
  authorize(UserRole.ADMIN, UserRole.MANAGER),
  asyncHandler(reportController.getSalesByProduct)
);

router.get(
  "/transactions/daily",
  authenticate,
  authorize(UserRole.ADMIN, UserRole.MANAGER),
  asyncHandler(reportController.getDailyTransactions)
);

router.get(
  "/export",
  authenticate,
  authorize(UserRole.ADMIN, UserRole.MANAGER),
  asyncHandler(reportController.exportReport)
);

router.get(
  "/gaming/daily",
  authenticate,
  authorize(UserRole.ADMIN, UserRole.MANAGER),
  asyncHandler(reportController.getDailyGamingReport)
);

router.get(
  "/gaming/monthly",
  authenticate,
  authorize(UserRole.ADMIN, UserRole.MANAGER),
  asyncHandler(reportController.getMonthlyGamingReport)
);

router.get(
  "/gaming-revenue",
  authenticate,
  authorize(UserRole.ADMIN, UserRole.MANAGER),
  asyncHandler(reportController.getGamingRevenue)
);

router.get(
  "/gaming-revenue-by-pc",
  authenticate,
  authorize(UserRole.ADMIN, UserRole.MANAGER),
  asyncHandler(reportController.getGamingRevenueByPC)
);

export default router;
