import { Response, NextFunction } from "express";
import { CustomRequest } from "../types";
import productService from "../services/product.service";
import { ApiResponseUtil } from "../utils/apiResponse";
import {
  CreateProductDto,
  UpdateProductDto,
  UpdateStockDto,
} from "../dtos/product.dto";

class ProductController {
  async createProduct(req: CustomRequest, res: Response, next: NextFunction) {
    const data: CreateProductDto = req.body;
    const product = await productService.createProduct(data);

    return ApiResponseUtil.created(
      res,
      {
        id: product._id.toString(),
        name: product.name,
        description: product.description,
        sku: product.sku,
        category: {
          id: product.category._id.toString(),
          name: (product.category as any).name,
        },
        pricing: product.pricing,
        inventory: product.inventory,
        image: product.image,
        createdAt: product.createdAt,
      },
      "Product created successfully"
    );
  }

  async getAllProducts(req: CustomRequest, res: Response, next: NextFunction) {
    const filters = {
      category: req.query.category as string,
      search: req.query.search as string,
      lowStock: req.query.lowStock === "true",
      minPrice: req.query.minPrice ? Number(req.query.minPrice) : undefined,
      maxPrice: req.query.maxPrice ? Number(req.query.maxPrice) : undefined,
      page: req.query.page ? Number(req.query.page) : 1,
      limit: req.query.limit ? Number(req.query.limit) : 20,
    };

    const result = await productService.getAllProducts(filters);

    return ApiResponseUtil.paginated(
      res,
      result.products.map((product) => ({
        id: product._id.toString(),
        name: product.name,
        description: product.description,
        sku: product.sku,
        category: {
          id: product.category._id.toString(),
          name: (product.category as any).name,
        },
        pricing: product.pricing,
        inventory: product.inventory,
        image: product.image,
        createdAt: product.createdAt,
      })),
      result.page,
      filters.limit,
      result.total,
      "Products retrieved successfully"
    );
  }

  async getProductById(req: CustomRequest, res: Response, next: NextFunction) {
    const { id } = req.params;
    const product = await productService.getProductById(id);

    return ApiResponseUtil.success(
      res,
      {
        id: product._id.toString(),
        name: product.name,
        description: product.description,
        sku: product.sku,
        category: {
          id: product.category._id.toString(),
          name: (product.category as any).name,
        },
        pricing: product.pricing,
        inventory: product.inventory,
        image: product.image,
        createdAt: product.createdAt,
        updatedAt: product.updatedAt,
      },
      "Product retrieved successfully"
    );
  }

  async getProductBySku(req: CustomRequest, res: Response, next: NextFunction) {
    const { sku } = req.params;
    const product = await productService.getProductBySku(sku);

    return ApiResponseUtil.success(
      res,
      {
        id: product._id.toString(),
        name: product.name,
        description: product.description,
        sku: product.sku,
        category: {
          id: product.category._id.toString(),
          name: (product.category as any).name,
        },
        pricing: product.pricing,
        inventory: product.inventory,
        image: product.image,
      },
      "Product retrieved successfully"
    );
  }

  async updateProduct(req: CustomRequest, res: Response, next: NextFunction) {
    const { id } = req.params;
    const updates: UpdateProductDto = req.body;
    const product = await productService.updateProduct(id, updates);

    return ApiResponseUtil.success(
      res,
      {
        id: product._id.toString(),
        name: product.name,
        description: product.description,
        sku: product.sku,
        category: {
          id: product.category._id.toString(),
          name: (product.category as any).name,
        },
        pricing: product.pricing,
        inventory: product.inventory,
        image: product.image,
        updatedAt: product.updatedAt,
      },
      "Product updated successfully"
    );
  }

  async updateStock(req: CustomRequest, res: Response, next: NextFunction) {
    const { id } = req.params;
    const { quantity }: UpdateStockDto = req.body;
    const product = await productService.updateStock(id, quantity);

    return ApiResponseUtil.success(
      res,
      {
        id: product._id.toString(),
        name: product.name,
        sku: product.sku,
        inventory: product.inventory,
      },
      "Stock updated successfully"
    );
  }

  async deleteProduct(req: CustomRequest, res: Response, next: NextFunction) {
    const { id } = req.params;
    await productService.deleteProduct(id);
    return ApiResponseUtil.noContent(res);
  }

  async getLowStockProducts(
    req: CustomRequest,
    res: Response,
    next: NextFunction
  ) {
    const products = await productService.getLowStockProducts();

    return ApiResponseUtil.success(
      res,
      products.map((product) => ({
        id: product._id.toString(),
        name: product.name,
        sku: product.sku,
        category: (product.category as any).name,
        inventory: product.inventory,
      })),
      "Low stock products retrieved successfully"
    );
  }

  async convertPrice(req: CustomRequest, res: Response, next: NextFunction) {
    const { amount, from } = req.query;

    if (!amount || !from) {
      return res.status(400).json({
        success: false,
        message: "Amount and from currency are required",
      });
    }

    const fromCurrency = (from as string).toUpperCase() as "USD" | "LBP";
    const result = await productService.convertPrice(
      Number(amount),
      fromCurrency
    );

    return ApiResponseUtil.success(res, result, "Price converted successfully");
  }
}

export default new ProductController();
