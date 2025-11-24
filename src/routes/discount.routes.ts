import { Router } from "express";
import discountController from "../controllers/discount.controller";
import { asyncHandler } from "../middlewares/asyncHandler";
import { authenticate, authorize } from "../middlewares/auth.middleware";
import { UserRole } from "../models/user.model";

const router = Router();

router.post(
  "/",
  authenticate,
  authorize(UserRole.ADMIN, UserRole.MANAGER),
  asyncHandler(discountController.createDiscount)
);

router.get(
  "/",
  authenticate,
  asyncHandler(discountController.getAllDiscounts)
);

router.get(
  "/product/:productId/active",
  authenticate,
  asyncHandler(discountController.getActiveDiscountsForProduct)
);

router.get(
  "/gaming-session/active",
  authenticate,
  asyncHandler(discountController.getActiveDiscountsForGamingSession)
);

router.get(
  "/sale/active",
  authenticate,
  asyncHandler(discountController.getActiveDiscountsForSale)
);

router.get(
  "/:id",
  authenticate,
  asyncHandler(discountController.getDiscountById)
);

router.put(
  "/:id",
  authenticate,
  authorize(UserRole.ADMIN, UserRole.MANAGER),
  asyncHandler(discountController.updateDiscount)
);

router.delete(
  "/:id",
  authenticate,
  authorize(UserRole.ADMIN),
  asyncHandler(discountController.deleteDiscount)
);

export default router;
