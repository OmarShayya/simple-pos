import { Router } from "express";
import pcController from "../controllers/pc.controller";
import gamingSessionController from "../controllers/gamingsession.controller";
import { validateDto } from "../middlewares/validation";
import { asyncHandler } from "../middlewares/asyncHandler";
import { authenticate, authorize } from "../middlewares/auth.middleware";
import {
  CreatePCDto,
  UpdatePCDto,
  StartSessionDto,
  EndSessionDto,
  ProcessSessionPaymentDto,
} from "../dtos/gaming.dto";
import { UserRole } from "../models/user.model";

const router = Router();

router.get("/pcs/status", asyncHandler(pcController.getPublicPCStatus));

router.post(
  "/pcs",
  authenticate,
  authorize(UserRole.ADMIN, UserRole.MANAGER),
  validateDto(CreatePCDto),
  asyncHandler(pcController.createPC)
);

router.patch(
  "/pcs/:id",
  authenticate,
  authorize(UserRole.ADMIN, UserRole.MANAGER),
  validateDto(UpdatePCDto),
  asyncHandler(pcController.updatePC)
);

router.get("/pcs", authenticate, asyncHandler(pcController.getAllPCs));

router.get(
  "/pcs/available",
  authenticate,
  asyncHandler(pcController.getAvailablePCs)
);

router.get("/pcs/:id", authenticate, asyncHandler(pcController.getPCById));

router.delete(
  "/pcs/:id",
  authenticate,
  authorize(UserRole.ADMIN),
  asyncHandler(pcController.deletePC)
);

// Session routes - Order matters! Specific routes must come before generic :id route
router.post(
  "/sessions",
  authenticate,
  validateDto(StartSessionDto),
  asyncHandler(gamingSessionController.startSession)
);

router.get(
  "/sessions",
  authenticate,
  asyncHandler(gamingSessionController.getAllSessions)
);

router.get(
  "/sessions/active",
  authenticate,
  asyncHandler(gamingSessionController.getActiveSessions)
);

router.get(
  "/sessions/today-stats",
  authenticate,
  authorize(UserRole.ADMIN, UserRole.MANAGER),
  asyncHandler(gamingSessionController.getTodayStats)
);

// Specific :id subroutes - must come before generic :id route
router.put(
  "/sessions/:id/end",
  authenticate,
  validateDto(EndSessionDto),
  asyncHandler(gamingSessionController.endSession)
);

router.post(
  "/sessions/:id/payment",
  authenticate,
  validateDto(ProcessSessionPaymentDto),
  asyncHandler(gamingSessionController.processPayment)
);

router.get(
  "/sessions/:id/current-cost",
  authenticate,
  asyncHandler(gamingSessionController.getCurrentCost)
);

router.patch(
  "/sessions/:id/cancel",
  authenticate,
  authorize(UserRole.ADMIN, UserRole.MANAGER),
  asyncHandler(gamingSessionController.cancelSession)
);

// Generic :id route - must come LAST
router.get(
  "/sessions/:id",
  authenticate,
  asyncHandler(gamingSessionController.getSessionById)
);

router.post(
  "/pcs/:id/lock",
  authenticate,
  authorize(UserRole.ADMIN, UserRole.MANAGER),
  asyncHandler(pcController.lockPC)
);

router.post(
  "/pcs/:id/unlock",
  authenticate,
  authorize(UserRole.ADMIN, UserRole.MANAGER),
  asyncHandler(pcController.unlockPC)
);

export default router;
