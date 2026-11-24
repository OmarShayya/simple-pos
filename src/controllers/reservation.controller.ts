import { Response, NextFunction } from "express";
import { CustomRequest } from "../types";
import { ApiResponseUtil } from "../utils/apiResponse";
import { ApiError } from "../utils/apiError";
import reservationService from "../services/reservation.service";
import { StationType } from "../models/pc.model";
import {
  CancelReservationDto,
  CheckInReservationDto,
  CreateReservationDto,
  CustomerReservationDto,
  UpdateReservationDto,
  UpdateReservationSettingsDto,
} from "../dtos/reservation.dto";

const parseAvailabilityQuery = (req: CustomRequest) => {
  const type = String(req.query.type || StationType.PC) as StationType;
  const date = String(req.query.date || "");
  const durationMinutes = Number(req.query.duration || req.query.durationMinutes || 60);
  if (!date) throw ApiError.badRequest("date is required (YYYY-MM-DD)");
  return { type, date, durationMinutes };
};

class ReservationController {
  // ------------------------------------------------------------ public

  async getPublicConfig(req: CustomRequest, res: Response, _next: NextFunction) {
    const config = await reservationService.getPublicConfig();
    return ApiResponseUtil.success(res, config, "Reservation settings retrieved");
  }

  async getAvailability(req: CustomRequest, res: Response, _next: NextFunction) {
    const data = await reservationService.getAvailability({ ...parseAvailabilityQuery(req), staff: false });
    return ApiResponseUtil.success(res, data, "Availability retrieved");
  }

  async createPublic(req: CustomRequest, res: Response, _next: NextFunction) {
    const body: CreateReservationDto = req.body;
    if (body.website) {
      // Honeypot tripped: pretend nothing happened
      throw ApiError.badRequest("Could not complete the booking");
    }
    const reservation = await reservationService.createReservation(body, { staff: false });
    const settings = await reservationService.getSettings();
    return ApiResponseUtil.created(
      res,
      reservationService.toPublic(reservation, settings.timezone),
      "Your booking is confirmed"
    );
  }

  async lookup(req: CustomRequest, res: Response, _next: NextFunction) {
    const { code, phone }: CustomerReservationDto = req.body;
    const reservation = await reservationService.lookup(code, phone);
    const settings = await reservationService.getSettings();
    return ApiResponseUtil.success(res, reservationService.toPublic(reservation, settings.timezone), "Booking found");
  }

  async cancelPublic(req: CustomRequest, res: Response, _next: NextFunction) {
    const { code, phone }: CustomerReservationDto = req.body;
    const reservation = await reservationService.cancelByCustomer(code, phone);
    const settings = await reservationService.getSettings();
    return ApiResponseUtil.success(res, reservationService.toPublic(reservation, settings.timezone), "Booking cancelled");
  }

  // ------------------------------------------------------------ staff

  async getStaffAvailability(req: CustomRequest, res: Response, _next: NextFunction) {
    const data = await reservationService.getAvailability({ ...parseAvailabilityQuery(req), staff: true });
    return ApiResponseUtil.success(res, data, "Availability retrieved");
  }

  async list(req: CustomRequest, res: Response, _next: NextFunction) {
    const reservations = await reservationService.list({
      date: req.query.date as string | undefined,
      from: req.query.from as string | undefined,
      to: req.query.to as string | undefined,
      status: req.query.status as string | undefined,
      type: req.query.type as StationType | undefined,
      search: req.query.search as string | undefined,
    });
    return ApiResponseUtil.success(res, reservations.map((r) => reservationService.toStaff(r)), "Reservations retrieved");
  }

  async getById(req: CustomRequest, res: Response, _next: NextFunction) {
    const r = await reservationService.getById(req.params.id);
    return ApiResponseUtil.success(res, reservationService.toStaff(r), "Reservation retrieved");
  }

  async createStaff(req: CustomRequest, res: Response, _next: NextFunction) {
    const body: CreateReservationDto = req.body;
    const r = await reservationService.createReservation(body, { staff: true, userId: req.user!.id });
    return ApiResponseUtil.created(res, reservationService.toStaff(r), "Reservation created");
  }

  async update(req: CustomRequest, res: Response, _next: NextFunction) {
    const body: UpdateReservationDto = req.body;
    const r = await reservationService.updateReservation(req.params.id, body);
    return ApiResponseUtil.success(res, reservationService.toStaff(r), "Reservation updated");
  }

  async cancel(req: CustomRequest, res: Response, _next: NextFunction) {
    const { reason }: CancelReservationDto = req.body;
    const r = await reservationService.cancelByStaff(req.params.id, reason);
    return ApiResponseUtil.success(res, reservationService.toStaff(r), "Reservation cancelled");
  }

  async noShow(req: CustomRequest, res: Response, _next: NextFunction) {
    const r = await reservationService.markNoShow(req.params.id);
    return ApiResponseUtil.success(res, reservationService.toStaff(r), "Marked as no-show");
  }

  async checkIn(req: CustomRequest, res: Response, _next: NextFunction) {
    const { createSale }: CheckInReservationDto = req.body;
    const r = await reservationService.checkIn(req.params.id, req.user!.id, { createSale });
    return ApiResponseUtil.success(res, reservationService.toStaff(r), "Checked in — sessions started");
  }

  async getSettings(req: CustomRequest, res: Response, _next: NextFunction) {
    const s = await reservationService.getSettings();
    return ApiResponseUtil.success(res, s, "Reservation settings retrieved");
  }

  async updateSettings(req: CustomRequest, res: Response, _next: NextFunction) {
    const body: UpdateReservationSettingsDto = req.body;
    const s = await reservationService.updateSettings(body as any, req.user!.id);
    return ApiResponseUtil.success(res, s, "Reservation settings saved");
  }
}

export default new ReservationController();
