import { Response, NextFunction } from "express";
import { CustomRequest } from "../types";
import categoryService from "../services/category.service";
import { ApiResponseUtil } from "../utils/apiResponse";
import { CreateCategoryDto, UpdateCategoryDto } from "../dtos/category.dto";

class CategoryController {
  async createCategory(req: CustomRequest, res: Response, next: NextFunction) {
    const data: CreateCategoryDto = req.body;
    const category = await categoryService.createCategory(data);

    return ApiResponseUtil.created(
      res,
      {
        id: category._id.toString(),
        name: category.name,
        description: category.description,
        image: category.image,
        createdAt: category.createdAt,
      },
      "Category created successfully"
    );
  }

  async getAllCategories(
    req: CustomRequest,
    res: Response,
    next: NextFunction
  ) {
    const includeInactive = req.query.includeInactive === "true";
    const categories = await categoryService.getAllCategories(includeInactive);

    return ApiResponseUtil.success(
      res,
      categories.map((cat) => ({
        id: cat._id.toString(),
        name: cat.name,
        description: cat.description,
        image: cat.image,
        isActive: cat.isActive,
        createdAt: cat.createdAt,
      })),
      "Categories retrieved successfully"
    );
  }

  async getCategoryById(req: CustomRequest, res: Response, next: NextFunction) {
    const { id } = req.params;
    const category = await categoryService.getCategoryById(id);

    return ApiResponseUtil.success(
      res,
      {
        id: category._id.toString(),
        name: category.name,
        description: category.description,
        image: category.image,
        isActive: category.isActive,
        createdAt: category.createdAt,
      },
      "Category retrieved successfully"
    );
  }

  async updateCategory(req: CustomRequest, res: Response, next: NextFunction) {
    const { id } = req.params;
    const updates: UpdateCategoryDto = req.body;
    const category = await categoryService.updateCategory(id, updates);

    return ApiResponseUtil.success(
      res,
      {
        id: category._id.toString(),
        name: category.name,
        description: category.description,
        image: category.image,
        updatedAt: category.updatedAt,
      },
      "Category updated successfully"
    );
  }

  async deleteCategory(req: CustomRequest, res: Response, next: NextFunction) {
    const { id } = req.params;
    await categoryService.deleteCategory(id);
    return ApiResponseUtil.noContent(res);
  }
}

export default new CategoryController();
