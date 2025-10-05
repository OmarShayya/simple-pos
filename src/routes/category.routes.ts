import { Router } from "express";
import categoryController from "../controllers/category.controller";
import { validateDto } from "../middlewares/validation";
import { asyncHandler } from "../middlewares/asyncHandler";
import { authenticate, authorize } from "../middlewares/auth.middleware";
import { validateImageUrl } from "../middlewares/validateImage";
import { CreateCategoryDto, UpdateCategoryDto } from "../dtos/category.dto";
import { UserRole } from "../models/user.model";

const router = Router();

router.post(
  "/",
  authenticate,
  authorize(UserRole.ADMIN, UserRole.MANAGER),
  validateImageUrl,
  validateDto(CreateCategoryDto),
  asyncHandler(categoryController.createCategory)
);

router.get(
  "/",
  authenticate,
  asyncHandler(categoryController.getAllCategories)
);

router.get(
  "/:id",
  authenticate,
  asyncHandler(categoryController.getCategoryById)
);

router.put(
  "/:id",
  authenticate,
  authorize(UserRole.ADMIN, UserRole.MANAGER),
  validateImageUrl,
  validateDto(UpdateCategoryDto),
  asyncHandler(categoryController.updateCategory)
);

router.delete(
  "/:id",
  authenticate,
  authorize(UserRole.ADMIN),
  asyncHandler(categoryController.deleteCategory)
);

export default router;
