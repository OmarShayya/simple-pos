import { Router } from "express";
import authController from "../controllers/auth.controller";
import { validateDto } from "../middlewares/validation";
import { asyncHandler } from "../middlewares/asyncHandler";
import { authenticate, authorize, optionalAuthenticate } from "../middlewares/auth.middleware";
import { RegisterDto, LoginDto, UpdateUserDto } from "../dtos/auth.dto";
import { UserRole } from "../models/user.model";

const router = Router();

// Public only until the first (admin) account exists; afterwards admins/managers create staff accounts.
router.get("/setup-status", asyncHandler(authController.getSetupStatus));

router.post(
  "/register",
  optionalAuthenticate,
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
