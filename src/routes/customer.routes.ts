import { Router } from "express";
import customerController from "../controllers/customer.controller";
import { validateDto } from "../middlewares/validation";
import { asyncHandler } from "../middlewares/asyncHandler";
import { authenticate, authorize } from "../middlewares/auth.middleware";
import {
  CreateCustomerDto,
  UpdateCustomerDto,
  UpdateBalanceDto,
} from "../dtos/customer.dto";
import { UserRole } from "../models/user.model";

const router = Router();

router.post(
  "/",
  authenticate,
  validateDto(CreateCustomerDto),
  asyncHandler(customerController.createCustomer)
);

router.get("/", authenticate, asyncHandler(customerController.getAllCustomers));

router.get(
  "/top",
  authenticate,
  authorize(UserRole.ADMIN, UserRole.MANAGER),
  asyncHandler(customerController.getTopCustomers)
);

router.get(
  "/:id",
  authenticate,
  asyncHandler(customerController.getCustomerById)
);

router.get(
  "/phone/:phone",
  authenticate,
  asyncHandler(customerController.getCustomerByPhone)
);

router.put(
  "/:id",
  authenticate,
  validateDto(UpdateCustomerDto),
  asyncHandler(customerController.updateCustomer)
);

router.patch(
  "/:id/balance",
  authenticate,
  authorize(UserRole.ADMIN, UserRole.MANAGER),
  validateDto(UpdateBalanceDto),
  asyncHandler(customerController.updateBalance)
);

router.delete(
  "/:id",
  authenticate,
  authorize(UserRole.ADMIN),
  asyncHandler(customerController.deleteCustomer)
);

export default router;
