import { Router } from "express";
import reservationController from "../controllers/reservation.controller";
import { validateDto } from "../middlewares/validation";
import { asyncHandler } from "../middlewares/asyncHandler";
import { authenticate, authorize } from "../middlewares/auth.middleware";
import { rateLimit } from "../middlewares/rateLimit";
import { UserRole } from "../models/user.model";
import {
  CancelReservationDto,
  CheckInReservationDto,
  CreateReservationDto,
  CustomerReservationDto,
  UpdateReservationDto,
  UpdateReservationSettingsDto,
} from "../dtos/reservation.dto";

const router = Router();

const bookingLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  message: "Too many booking attempts. Please try again later or call us.",
});
const lookupLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 30 });

// ---------------------------------------------------------------- public (website)

router.get("/public/config", asyncHandler(reservationController.getPublicConfig));
router.get("/public/availability", asyncHandler(reservationController.getAvailability));
router.post(
  "/public",
  bookingLimiter,
  validateDto(CreateReservationDto),
  asyncHandler(reservationController.createPublic)
);
router.post(
  "/public/lookup",
  lookupLimiter,
  validateDto(CustomerReservationDto),
  asyncHandler(reservationController.lookup)
);
router.post(
  "/public/cancel",
  lookupLimiter,
  validateDto(CustomerReservationDto),
  asyncHandler(reservationController.cancelPublic)
);

// ---------------------------------------------------------------- staff (POS)

router.get("/settings", authenticate, asyncHandler(reservationController.getSettings));
router.put(
  "/settings",
  authenticate,
  authorize(UserRole.ADMIN, UserRole.MANAGER),
  validateDto(UpdateReservationSettingsDto),
  asyncHandler(reservationController.updateSettings)
);

router.get("/availability", authenticate, asyncHandler(reservationController.getStaffAvailability));
router.get("/", authenticate, asyncHandler(reservationController.list));
router.post("/", authenticate, validateDto(CreateReservationDto), asyncHandler(reservationController.createStaff));

router.post(
  "/:id/check-in",
  authenticate,
  validateDto(CheckInReservationDto),
  asyncHandler(reservationController.checkIn)
);
router.patch("/:id/cancel", authenticate, validateDto(CancelReservationDto), asyncHandler(reservationController.cancel));
router.patch("/:id/no-show", authenticate, asyncHandler(reservationController.noShow));
router.patch("/:id", authenticate, validateDto(UpdateReservationDto), asyncHandler(reservationController.update));
router.get("/:id", authenticate, asyncHandler(reservationController.getById));

export default router;
