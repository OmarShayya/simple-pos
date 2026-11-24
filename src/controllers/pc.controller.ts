import { Response, NextFunction } from "express";
import { CustomRequest } from "../types";
import pcService from "../services/pc.service";
import { ApiResponseUtil } from "../utils/apiResponse";
import { CreatePCDto, UpdatePCDto } from "../dtos/gaming.dto";
import { IPC, PCStatus, StationType } from "../models/pc.model";
import reservationService from "../services/reservation.service";
import { IReservation } from "../models/reservation.model";

/** Single place that shapes a station for API responses. */
const formatPC = (pc: IPC, upcoming?: IReservation) => ({
  id: pc._id.toString(),
  type: pc.type ?? StationType.PC,
  pcNumber: pc.pcNumber,
  name: pc.name,
  status: pc.status,
  hourlyRate: pc.hourlyRate,
  specifications: pc.specifications,
  location: pc.location,
  notes: pc.notes,
  isActive: pc.isActive,
  createdAt: pc.createdAt,
  updatedAt: pc.updatedAt,
  upcomingReservation: upcoming
    ? {
        id: upcoming._id.toString(),
        code: upcoming.code,
        customerName: upcoming.customerName,
        startTime: upcoming.startTime,
        endTime: upcoming.endTime,
        status: upcoming.status,
      }
    : undefined,
});

class PCController {
  async createPC(req: CustomRequest, res: Response, next: NextFunction) {
    const data: CreatePCDto = req.body;
    const pc = await pcService.createPC(data);

    return ApiResponseUtil.created(
      res,
      formatPC(pc),
      "Station created successfully"
    );
  }

  async updatePC(req: CustomRequest, res: Response, next: NextFunction) {
    const { id } = req.params;
    const data: UpdatePCDto = req.body;
    const pc = await pcService.updatePC(id, data);

    return ApiResponseUtil.success(
      res,
      formatPC(pc),
      "Station updated successfully"
    );
  }

  async getPCById(req: CustomRequest, res: Response, next: NextFunction) {
    const { id } = req.params;
    const pc = await pcService.getPCById(id);

    return ApiResponseUtil.success(
      res,
      formatPC(pc),
      "Station retrieved successfully"
    );
  }

  async getAllPCs(req: CustomRequest, res: Response, next: NextFunction) {
    const filters = {
      status: req.query.status as PCStatus,
      type: req.query.type as StationType | undefined,
      isActive: req.query.isActive ? req.query.isActive === "true" : undefined,
      page: req.query.page ? Number(req.query.page) : 1,
      limit: req.query.limit ? Number(req.query.limit) : 50,
    };

    const [result, upcoming] = await Promise.all([
      pcService.getAllPCs(filters),
      reservationService.getUpcomingByStation(12),
    ]);

    return ApiResponseUtil.paginated(
      res,
      result.pcs.map((pc) => formatPC(pc, upcoming.get(pc._id.toString()))),
      result.page,
      filters.limit,
      result.total,
      "PCs retrieved successfully"
    );
  }

  async deletePC(req: CustomRequest, res: Response, next: NextFunction) {
    const { id } = req.params;
    await pcService.deletePC(id);

    return ApiResponseUtil.success(res, null, "PC deleted successfully");
  }

  async getAvailablePCs(req: CustomRequest, res: Response, next: NextFunction) {
    const pcs = await pcService.getAvailablePCs();

    return ApiResponseUtil.success(
      res,
      pcs.map((pc) => formatPC(pc)),
      "Available PCs retrieved successfully"
    );
  }

  async lockPC(req: CustomRequest, res: Response, next: NextFunction) {
    const { id } = req.params;
    const { customerId, customerName } = req.body;

    const pc = await pcService.lockPC(
      id,
      customerId,
      customerName,
      req.user!.id
    ); // Pass user ID

    return ApiResponseUtil.success(
      res,
      {
        id: pc._id.toString(),
        pcNumber: pc.pcNumber,
        name: pc.name,
        status: pc.status,
      },
      "PC locked successfully"
    );
  }

  async unlockPC(req: CustomRequest, res: Response, next: NextFunction) {
    const { id } = req.params;

    const pc = await pcService.unlockPC(id);

    return ApiResponseUtil.success(
      res,
      {
        id: pc._id.toString(),
        pcNumber: pc.pcNumber,
        name: pc.name,
        status: pc.status,
      },
      "PC unlocked successfully"
    );
  }

  async getPublicPCStatus(
    req: CustomRequest,
    res: Response,
    next: NextFunction
  ) {
    const [pcs, upcoming] = await Promise.all([
      pcService.getAllPCs({ limit: 200, isActive: true }),
      reservationService.getUpcomingByStation(12),
    ]);

    const pcStatus = pcs.pcs.map((pc) => {
      const next = upcoming.get(pc._id.toString());
      return {
        pcNumber: pc.pcNumber,
        name: pc.name,
        type: pc.type ?? StationType.PC,
        status: pc.status,
        location: pc.location,
        // Only the time slot is public — never the customer's details
        nextReservation: next ? { startTime: next.startTime, endTime: next.endTime } : undefined,
      };
    });

    const countFor = (list: typeof pcStatus) => ({
      total: list.length,
      available: list.filter((p) => p.status === PCStatus.AVAILABLE).length,
      occupied: list.filter((p) => p.status === PCStatus.OCCUPIED).length,
      maintenance: list.filter((p) => p.status === PCStatus.MAINTENANCE).length,
    });

    return ApiResponseUtil.success(
      res,
      {
        pcs: pcStatus,
        // `stats` keeps its original meaning (PCs only) for older website builds
        stats: countFor(pcStatus.filter((p) => p.type === StationType.PC)),
        statsByType: {
          pc: countFor(pcStatus.filter((p) => p.type === StationType.PC)),
          playstation: countFor(pcStatus.filter((p) => p.type === StationType.PLAYSTATION)),
        },
      },
      "Station status retrieved successfully"
    );
  }
}

export default new PCController();
