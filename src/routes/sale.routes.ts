import { Router } from "express";
import saleController from "../controllers/sale.controller";
import { validateDto } from "../middlewares/validation";
import { asyncHandler } from "../middlewares/asyncHandler";
import { authenticate, authorize } from "../middlewares/auth.middleware";
import { CreateSaleDto, PaySaleDto, UpdateSaleDto } from "../dtos/sale.dto";
import { UserRole } from "../models/user.model";

const router = Router();

router.post(
  "/",
  authenticate,
  validateDto(CreateSaleDto),
  asyncHandler(saleController.createSale)
);

router.patch(
  "/:id",
  authenticate,
  validateDto(UpdateSaleDto),
  asyncHandler(saleController.updateSale)
);

router.post(
  "/:id/pay",
  authenticate,
  validateDto(PaySaleDto),
  asyncHandler(saleController.paySale)
);

router.get("/", authenticate, asyncHandler(saleController.getAllSales));

router.get(
  "/today",
  authenticate,
  authorize(UserRole.ADMIN, UserRole.MANAGER),
  asyncHandler(saleController.getTodaySales)
);

router.get("/:id", authenticate, asyncHandler(saleController.getSaleById));

router.get(
  "/invoice/:invoiceNumber",
  authenticate,
  asyncHandler(saleController.getSaleByInvoice)
);

router.patch(
  "/:id/cancel",
  authenticate,
  authorize(UserRole.ADMIN, UserRole.MANAGER),
  asyncHandler(saleController.cancelSale)
);

export default router;
