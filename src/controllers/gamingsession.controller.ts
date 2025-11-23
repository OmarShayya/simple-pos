import { Response, NextFunction } from "express";
import { CustomRequest } from "../types";
import gamingSessionService from "../services/gamingsession.service";
import { ApiResponseUtil } from "../utils/apiResponse";
import { StartSessionDto, ProcessSessionPaymentDto } from "../dtos/gaming.dto";
import {
  SessionStatus,
  SessionPaymentStatus,
} from "../models/gamingsession.model";

class GamingSessionController {
  async startSession(req: CustomRequest, res: Response, next: NextFunction) {
    const data: StartSessionDto = req.body;
    const cashierId = req.user!.id;
    const session = await gamingSessionService.startSession(cashierId, data);

    return ApiResponseUtil.created(
      res,
      {
        id: session._id.toString(),
        sessionNumber: session.sessionNumber,
        pc: {
          id: (session.pc as any)._id.toString(),
          pcNumber: (session.pc as any).pcNumber,
          name: (session.pc as any).name,
        },
        customer: session.customer
          ? {
              id: (session.customer as any)._id.toString(),
              name: (session.customer as any).name,
            }
          : null,
        customerName: session.customerName,
        startTime: session.startTime,
        hourlyRate: session.hourlyRate,
        status: session.status,
        startedBy: {
          name: (session.startedBy as any).name,
        },
      },
      "Gaming session started successfully"
    );
  }

  async endSession(req: CustomRequest, res: Response, next: NextFunction) {
    const { id } = req.params;
    const cashierId = req.user!.id;
    const session = await gamingSessionService.endSession(id, cashierId);

    return ApiResponseUtil.success(
      res,
      {
        id: session._id.toString(),
        sessionNumber: session.sessionNumber,
        pc: {
          id: (session.pc as any)._id.toString(),
          pcNumber: (session.pc as any).pcNumber,
          name: (session.pc as any).name,
        },
        customer: session.customer
          ? {
              id: (session.customer as any)._id.toString(),
              name: (session.customer as any).name,
            }
          : null,
        customerName: session.customerName,
        startTime: session.startTime,
        endTime: session.endTime,
        duration: session.duration,
        totalCost: session.totalCost,
        status: session.status,
        paymentStatus: session.paymentStatus,
      },
      "Gaming session ended successfully"
    );
  }

  async processPayment(req: CustomRequest, res: Response, next: NextFunction) {
    const { id } = req.params;
    const paymentData: ProcessSessionPaymentDto = req.body;
    const session = await gamingSessionService.processPayment(id, paymentData);

    return ApiResponseUtil.success(
      res,
      {
        id: session._id.toString(),
        sessionNumber: session.sessionNumber,
        totalCost: session.totalCost,
        paymentStatus: session.paymentStatus,
        sale: session.sale
          ? {
              id: (session.sale as any)._id.toString(),
              invoiceNumber: (session.sale as any).invoiceNumber,
            }
          : null,
      },
      "Payment processed successfully"
    );
  }

  async getSessionById(req: CustomRequest, res: Response, next: NextFunction) {
    const { id } = req.params;
    const session = await gamingSessionService.getSessionById(id);

    return ApiResponseUtil.success(
      res,
      {
        id: session._id.toString(),
        sessionNumber: session.sessionNumber,
        pc: {
          id: (session.pc as any)._id.toString(),
          pcNumber: (session.pc as any).pcNumber,
          name: (session.pc as any).name,
        },
        customer: session.customer
          ? {
              id: (session.customer as any)._id.toString(),
              name: (session.customer as any).name,
              phone: (session.customer as any).phone,
            }
          : null,
        customerName: session.customerName,
        startTime: session.startTime,
        endTime: session.endTime,
        duration: session.duration,
        hourlyRate: session.hourlyRate,
        totalCost: session.totalCost,
        status: session.status,
        paymentStatus: session.paymentStatus,
        startedBy: { name: (session.startedBy as any).name },
        endedBy: session.endedBy
          ? { name: (session.endedBy as any).name }
          : null,
        sale: session.sale
          ? {
              id: (session.sale as any)._id.toString(),
              invoiceNumber: (session.sale as any).invoiceNumber,
            }
          : null,
        notes: session.notes,
        createdAt: session.createdAt,
      },
      "Session retrieved successfully"
    );
  }

  async getAllSessions(req: CustomRequest, res: Response, next: NextFunction) {
    const filters = {
      status: req.query.status as SessionStatus,
      pcId: req.query.pcId as string,
      customerId: req.query.customerId as string,
      startDate: req.query.startDate as string | undefined,
      endDate: req.query.endDate as string | undefined,
      paymentStatus: req.query.paymentStatus as SessionPaymentStatus,
      page: req.query.page ? Number(req.query.page) : 1,
      limit: req.query.limit ? Number(req.query.limit) : 20,
    };

    const result = await gamingSessionService.getAllSessions(filters);

    return ApiResponseUtil.paginated(
      res,
      result.sessions.map((session) => ({
        id: session._id.toString(),
        sessionNumber: session.sessionNumber,
        pc: {
          pcNumber: (session.pc as any).pcNumber,
          name: (session.pc as any).name,
        },
        customer: session.customer
          ? {
              name: (session.customer as any).name,
              phone: (session.customer as any).phone,
            }
          : null,
        customerName: session.customerName,
        startTime: session.startTime,
        endTime: session.endTime,
        duration: session.duration,
        totalCost: session.totalCost,
        status: session.status,
        paymentStatus: session.paymentStatus,
        startedBy: (session.startedBy as any).name,
      })),
      result.page,
      filters.limit,
      result.total,
      "Sessions retrieved successfully"
    );
  }

  async getActiveSessions(
    req: CustomRequest,
    res: Response,
    next: NextFunction
  ) {
    const sessions = await gamingSessionService.getActiveSessions();

    return ApiResponseUtil.success(
      res,
      sessions.map((session) => {
        const now = new Date();
        const durationMs = now.getTime() - session.startTime.getTime();
        const durationMinutes = Math.ceil(durationMs / (1000 * 60));
        const durationHours = durationMinutes / 60;
        const currentCostUsd = session.hourlyRate.usd * durationHours;
        const currentCostLbp = session.hourlyRate.lbp * durationHours;

        return {
          id: session._id.toString(),
          sessionNumber: session.sessionNumber,
          pc: {
            id: (session.pc as any)._id.toString(),
            pcNumber: (session.pc as any).pcNumber,
            name: (session.pc as any).name,
            status: (session.pc as any).status,
          },
          customer: session.customer
            ? {
                id: (session.customer as any)._id.toString(),
                name: (session.customer as any).name,
                phone: (session.customer as any).phone,
              }
            : null,
          customerName: session.customerName,
          startTime: session.startTime,
          currentDuration: durationMinutes,
          currentCost: {
            usd: Math.round(currentCostUsd * 100) / 100,
            lbp: Math.round(currentCostLbp),
          },
          hourlyRate: session.hourlyRate,
          startedBy: { name: (session.startedBy as any).name },
        };
      }),
      "Active sessions retrieved successfully"
    );
  }

  async getCurrentCost(req: CustomRequest, res: Response, next: NextFunction) {
    const { id } = req.params;
    const result = await gamingSessionService.getCurrentCost(id);

    return ApiResponseUtil.success(
      res,
      result,
      "Current cost calculated successfully"
    );
  }

  async cancelSession(req: CustomRequest, res: Response, next: NextFunction) {
    const { id } = req.params;
    const cashierId = req.user!.id;
    await gamingSessionService.cancelSession(id, cashierId);

    return ApiResponseUtil.success(res, null, "Session cancelled successfully");
  }

  async getTodayStats(req: CustomRequest, res: Response, next: NextFunction) {
    const stats = await gamingSessionService.getTodayStats();

    return ApiResponseUtil.success(
      res,
      stats,
      "Today's gaming stats retrieved successfully"
    );
  }
}

export default new GamingSessionController();
