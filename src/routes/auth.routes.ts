import { Router } from "express";
import authController from "../controllers/auth.controller";
import { validateDto } from "../middlewares/validation";
import { asyncHandler } from "../middlewares/asyncHandler";
import { authenticate, authorize } from "../middlewares/auth.middleware";
import { RegisterDto, LoginDto, UpdateUserDto } from "../dtos/auth.dto";
import { UserRole } from "../models/user.model";

const router = Router();

router.post(
  "/register",
  validateDto(RegisterDto),
  asyncHandler(authController.register)
);

router.post(
  "/login",
  validateDto(LoginDto),
  asyncHandler(authController.login)
);

router.get("/profile", authenticate, asyncHandler(authController.getProfile));

router.get(
  "/users",
  authenticate,
  authorize(UserRole.ADMIN, UserRole.MANAGER),
  asyncHandler(authController.getAllUsers)
);

router.put(
  "/users/:id",
  authenticate,
  authorize(UserRole.ADMIN),
  validateDto(UpdateUserDto),
  asyncHandler(authController.updateUser)
);

router.delete(
  "/users/:id",
  authenticate,
  authorize(UserRole.ADMIN),
  asyncHandler(authController.deactivateUser)
);

export default router;
