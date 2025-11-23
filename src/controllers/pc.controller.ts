import { Response, NextFunction } from "express";
import { CustomRequest } from "../types";
import pcService from "../services/pc.service";
import { ApiResponseUtil } from "../utils/apiResponse";
import { CreatePCDto, UpdatePCDto } from "../dtos/gaming.dto";
import { PCStatus } from "../models/pc.model";

class PCController {
  async createPC(req: CustomRequest, res: Response, next: NextFunction) {
    const data: CreatePCDto = req.body;
    const pc = await pcService.createPC(data);

    return ApiResponseUtil.created(
      res,
      {
        id: pc._id.toString(),
        pcNumber: pc.pcNumber,
        name: pc.name,
        status: pc.status,
        hourlyRate: pc.hourlyRate,
        specifications: pc.specifications,
        location: pc.location,
        notes: pc.notes,
        isActive: pc.isActive,
        createdAt: pc.createdAt,
      },
      "PC created successfully"
    );
  }

  async updatePC(req: CustomRequest, res: Response, next: NextFunction) {
    const { id } = req.params;
    const data: UpdatePCDto = req.body;
    const pc = await pcService.updatePC(id, data);

    return ApiResponseUtil.success(
      res,
      {
        id: pc._id.toString(),
        pcNumber: pc.pcNumber,
        name: pc.name,
        status: pc.status,
        hourlyRate: pc.hourlyRate,
        specifications: pc.specifications,
        location: pc.location,
        notes: pc.notes,
        isActive: pc.isActive,
        updatedAt: pc.updatedAt,
      },
      "PC updated successfully"
    );
  }

  async getPCById(req: CustomRequest, res: Response, next: NextFunction) {
    const { id } = req.params;
    const pc = await pcService.getPCById(id);

    return ApiResponseUtil.success(
      res,
      {
        id: pc._id.toString(),
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
      },
      "PC retrieved successfully"
    );
  }

  async getAllPCs(req: CustomRequest, res: Response, next: NextFunction) {
    const filters = {
      status: req.query.status as PCStatus,
      isActive: req.query.isActive ? req.query.isActive === "true" : undefined,
      page: req.query.page ? Number(req.query.page) : 1,
      limit: req.query.limit ? Number(req.query.limit) : 50,
    };

    const result = await pcService.getAllPCs(filters);

    return ApiResponseUtil.paginated(
      res,
      result.pcs.map((pc) => ({
        id: pc._id.toString(),
        pcNumber: pc.pcNumber,
        name: pc.name,
        status: pc.status,
        hourlyRate: pc.hourlyRate,
        specifications: pc.specifications,
        location: pc.location,
        isActive: pc.isActive,
        createdAt: pc.createdAt,
      })),
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
      pcs.map((pc) => ({
        id: pc._id.toString(),
        pcNumber: pc.pcNumber,
        name: pc.name,
        status: pc.status,
        hourlyRate: pc.hourlyRate,
        location: pc.location,
      })),
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
    const pcs = await pcService.getAllPCs({ limit: 100 });

    const pcStatus = pcs.pcs.map((pc) => ({
      pcNumber: pc.pcNumber,
      name: pc.name,
      status: pc.status,
      location: pc.location,
    }));

    const stats = {
      total: pcStatus.length,
      available: pcStatus.filter((p) => p.status === PCStatus.AVAILABLE).length,
      occupied: pcStatus.filter((p) => p.status === PCStatus.OCCUPIED).length,
      maintenance: pcStatus.filter((p) => p.status === PCStatus.MAINTENANCE)
        .length,
    };

    return ApiResponseUtil.success(
      res,
      {
        pcs: pcStatus,
        stats,
      },
      "PC status retrieved successfully"
    );
  }
}

export default new PCController();
