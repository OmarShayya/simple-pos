import { Router } from "express";
import productController from "../controllers/product.controller";
import { validateDto } from "../middlewares/validation";
import { asyncHandler } from "../middlewares/asyncHandler";
import { authenticate, authorize } from "../middlewares/auth.middleware";
import { validateImageUrl } from "../middlewares/validateImage";
import {
  CreateProductDto,
  UpdateProductDto,
  UpdateStockDto,
} from "../dtos/product.dto";
import { UserRole } from "../models/user.model";

const router = Router();

router.post(
  "/",
  authenticate,
  authorize(UserRole.ADMIN, UserRole.MANAGER),
  validateImageUrl,
  validateDto(CreateProductDto),
  asyncHandler(productController.createProduct)
);

router.get("/", authenticate, asyncHandler(productController.getAllProducts));

router.get(
  "/low-stock",
  authenticate,
  authorize(UserRole.ADMIN, UserRole.MANAGER),
  asyncHandler(productController.getLowStockProducts)
);

router.get(
  "/convert-price",
  authenticate,
  asyncHandler(productController.convertPrice)
);

router.get(
  "/:id",
  authenticate,
  asyncHandler(productController.getProductById)
);

router.get(
  "/sku/:sku",
  authenticate,
  asyncHandler(productController.getProductBySku)
);

router.put(
  "/:id",
  authenticate,
  authorize(UserRole.ADMIN, UserRole.MANAGER),
  validateImageUrl,
  validateDto(UpdateProductDto),
  asyncHandler(productController.updateProduct)
);

router.patch(
  "/:id/stock",
  authenticate,
  authorize(UserRole.ADMIN, UserRole.MANAGER),
  validateDto(UpdateStockDto),
  asyncHandler(productController.updateStock)
);

router.delete(
  "/:id",
  authenticate,
  authorize(UserRole.ADMIN),
  asyncHandler(productController.deleteProduct)
);

export default router;
