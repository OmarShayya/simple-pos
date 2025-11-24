import { Response, NextFunction } from "express";
import { CustomRequest } from "../types";
import discountService from "../services/discount.service";
import { ApiResponseUtil } from "../utils/apiResponse";
import { DiscountTarget } from "../models/discount.model";

class DiscountController {
  async createDiscount(req: CustomRequest, res: Response, next: NextFunction) {
    const userId = req.user?.id;
    const data = req.body;
    const discount = await discountService.createDiscount(userId!, data);

    return ApiResponseUtil.created(
      res,
      {
        id: discount._id.toString(),
        name: discount.name,
        description: discount.description,
        type: discount.type,
        value: discount.value,
        target: discount.target,
        targetId: discount.targetId?.toString(),
        isActive: discount.isActive,
        startDate: discount.startDate,
        endDate: discount.endDate,
        createdAt: discount.createdAt,
      },
      "Discount created successfully"
    );
  }

  async getAllDiscounts(req: CustomRequest, res: Response, next: NextFunction) {
    const filters = {
      target: req.query.target as DiscountTarget | undefined,
      isActive: req.query.isActive === "true" ? true : req.query.isActive === "false" ? false : undefined,
      targetId: req.query.targetId as string | undefined,
      page: req.query.page ? parseInt(req.query.page as string) : 1,
      limit: req.query.limit ? parseInt(req.query.limit as string) : 20,
    };

    const result = await discountService.getAllDiscounts(filters);

    return ApiResponseUtil.paginated(
      res,
      result.discounts.map((d) => ({
        id: d._id.toString(),
        name: d.name,
        description: d.description,
        type: d.type,
        value: d.value,
        target: d.target,
        targetId: d.targetId?.toString(),
        targetDetails: d.targetId,
        isActive: d.isActive,
        startDate: d.startDate,
        endDate: d.endDate,
        createdBy: d.createdBy,
        createdAt: d.createdAt,
      })),
      result.page,
      filters.limit,
      result.total,
      "Discounts retrieved successfully"
    );
  }

  async getDiscountById(req: CustomRequest, res: Response, next: NextFunction) {
    const { id } = req.params;
    const discount = await discountService.getDiscountById(id);

    return ApiResponseUtil.success(
      res,
      {
        id: discount._id.toString(),
        name: discount.name,
        description: discount.description,
        type: discount.type,
        value: discount.value,
        target: discount.target,
        targetId: discount.targetId?.toString(),
        targetDetails: discount.targetId,
        isActive: discount.isActive,
        startDate: discount.startDate,
        endDate: discount.endDate,
        createdBy: discount.createdBy,
        createdAt: discount.createdAt,
        updatedAt: discount.updatedAt,
      },
      "Discount retrieved successfully"
    );
  }

  async updateDiscount(req: CustomRequest, res: Response, next: NextFunction) {
    const { id } = req.params;
    const data = req.body;
    const discount = await discountService.updateDiscount(id, data);

    return ApiResponseUtil.success(
      res,
      {
        id: discount._id.toString(),
        name: discount.name,
        description: discount.description,
        type: discount.type,
        value: discount.value,
        target: discount.target,
        targetId: discount.targetId?.toString(),
        isActive: discount.isActive,
        startDate: discount.startDate,
        endDate: discount.endDate,
        updatedAt: discount.updatedAt,
      },
      "Discount updated successfully"
    );
  }

  async deleteDiscount(req: CustomRequest, res: Response, next: NextFunction) {
    const { id } = req.params;
    await discountService.deleteDiscount(id);
    return ApiResponseUtil.noContent(res);
  }

  async getActiveDiscountsForProduct(
    req: CustomRequest,
    res: Response,
    next: NextFunction
  ) {
    const { productId } = req.params;
    const discounts = await discountService.getActiveDiscountsForProduct(productId);

    return ApiResponseUtil.success(
      res,
      discounts.map((d) => ({
        id: d._id.toString(),
        name: d.name,
        description: d.description,
        value: d.value,
        target: d.target,
        targetId: d.targetId?.toString(),
      })),
      "Active discounts for product retrieved successfully"
    );
  }

  async getActiveDiscountsForGamingSession(
    req: CustomRequest,
    res: Response,
    next: NextFunction
  ) {
    const discounts = await discountService.getActiveDiscountsForGamingSession();

    return ApiResponseUtil.success(
      res,
      discounts.map((d) => ({
        id: d._id.toString(),
        name: d.name,
        description: d.description,
        value: d.value,
        target: d.target,
      })),
      "Active gaming session discounts retrieved successfully"
    );
  }

  async getActiveDiscountsForSale(
    req: CustomRequest,
    res: Response,
    next: NextFunction
  ) {
    const discounts = await discountService.getActiveDiscountsForSale();

    return ApiResponseUtil.success(
      res,
      discounts.map((d) => ({
        id: d._id.toString(),
        name: d.name,
        description: d.description,
        value: d.value,
        target: d.target,
      })),
      "Active sale discounts retrieved successfully"
    );
  }
}

export default new DiscountController();
