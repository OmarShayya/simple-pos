import { Router } from "express";
import exchangeRateController from "../controllers/exchangeRate.controller";
import { validateDto } from "../middlewares/validation";
import { asyncHandler } from "../middlewares/asyncHandler";
import { authenticate, authorize } from "../middlewares/auth.middleware";
import { UpdateExchangeRateDto } from "../dtos/exchangeRate.dto";
import { UserRole } from "../models/user.model";

const router = Router();

router.get(
  "/current",
  authenticate,
  asyncHandler(exchangeRateController.getCurrentRate)
);

router.post(
  "/update",
  authenticate,
  authorize(UserRole.ADMIN, UserRole.MANAGER),
  validateDto(UpdateExchangeRateDto),
  asyncHandler(exchangeRateController.updateRate)
);

router.get(
  "/history",
  authenticate,
  authorize(UserRole.ADMIN, UserRole.MANAGER),
  asyncHandler(exchangeRateController.getRateHistory)
);

router.get(
  "/convert",
  authenticate,
  asyncHandler(exchangeRateController.convertCurrency)
);

export default router;
