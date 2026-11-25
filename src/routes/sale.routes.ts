import { Router } from "express";
import saleController from "../controllers/sale.controller";
import { validateDto, validateQuery } from "../middlewares/validation";
import { asyncHandler } from "../middlewares/asyncHandler";
import { authenticate, authorize } from "../middlewares/auth.middleware";
import { rateLimit } from "../middlewares/rateLimit";
import {
  CreateSaleDto,
  ListOrdersQueryDto,
  PaySaleDto,
  PublicOrderDto,
  UpdateSaleDto,
} from "../dtos/sale.dto";
import { UserRole } from "../models/user.model";

const router = Router();

const websiteOrderLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  message: "Too many orders from this device. Please try again later or call us.",
});

// ---------------------------------------------------------------- public (website menu)
router.post(
  "/public",
  websiteOrderLimiter,
  validateDto(PublicOrderDto),
  asyncHandler(saleController.createPublicOrder)
);

// ---------------------------------------------------------------- staff
router.post(
  "/",
  authenticate,
  validateDto(CreateSaleDto),
  asyncHandler(saleController.createSale)
);

router.get("/", authenticate, validateQuery(ListOrdersQueryDto), asyncHandler(saleController.getAllSales));

router.get("/counts", authenticate, asyncHandler(saleController.getCounts));

router.get(
  "/today",
  authenticate,
  authorize(UserRole.ADMIN, UserRole.MANAGER),
  asyncHandler(saleController.getTodaySales)
);

router.get(
  "/invoice/:invoiceNumber",
  authenticate,
  asyncHandler(saleController.getSaleByInvoice)
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

router.patch(
  "/:id/cancel",
  authenticate,
  authorize(UserRole.ADMIN, UserRole.MANAGER),
  asyncHandler(saleController.cancelSale)
);

router.get("/:id", authenticate, asyncHandler(saleController.getSaleById));

export default router;
