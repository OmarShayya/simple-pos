import Product, { IProduct } from "../models/product.model";
import Category from "../models/category.model";
import { ApiError } from "../utils/apiError";
import config from "../config/config";

interface ProductFilters {
  category?: string;
  search?: string;
  lowStock?: boolean;
  minPrice?: number;
  maxPrice?: number;
  page?: number;
  limit?: number;
}

class ProductService {
  async createProduct(data: {
    name: string;
    description?: string;
    sku: string;
    category: string;
    pricing: { usd: number; lbp: number };
    inventory: { quantity: number; minStockLevel?: number };
    image?: string;
  }): Promise<IProduct> {
    // Check if category exists
    const categoryExists = await Category.findById(data.category);
    if (!categoryExists) {
      throw ApiError.notFound("Category not found");
    }

    // Check if SKU already exists
    const existingSku = await Product.findOne({
      sku: data.sku.toUpperCase(),
    });
    if (existingSku) {
      throw ApiError.conflict("Product with this SKU already exists");
    }

    const product = await Product.create({
      ...data,
      sku: data.sku.toUpperCase(),
    });

    return await product.populate("category");
  }

  async getAllProducts(filters: ProductFilters): Promise<{
    products: IProduct[];
    total: number;
    page: number;
    totalPages: number;
  }> {
    const {
      category,
      search,
      lowStock,
      minPrice,
      maxPrice,
      page = 1,
      limit = 20,
    } = filters;

    const query: any = { isActive: true };

    // Category filter
    if (category) {
      query.category = category;
    }

    // Search filter (name, description, SKU)
    if (search) {
      query.$text = { $search: search };
    }

    // Low stock filter
    if (lowStock) {
      query["inventory.isLowStock"] = true;
    }

    // Price range filter (using USD)
    if (minPrice || maxPrice) {
      query["pricing.usd"] = {};
      if (minPrice) query["pricing.usd"].$gte = minPrice;
      if (maxPrice) query["pricing.usd"].$lte = maxPrice;
    }

    const skip = (page - 1) * limit;

    const [products, total] = await Promise.all([
      Product.find(query)
        .populate("category")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      Product.countDocuments(query),
    ]);

    return {
      products,
      total,
      page,
      totalPages: Math.ceil(total / limit),
    };
  }

  async getProductById(id: string): Promise<IProduct> {
    const product = await Product.findById(id).populate("category");
    if (!product) {
      throw ApiError.notFound("Product not found");
    }
    return product;
  }

  async getProductBySku(sku: string): Promise<IProduct> {
    const product = await Product.findOne({
      sku: sku.toUpperCase(),
      isActive: true,
    }).populate("category");

    if (!product) {
      throw ApiError.notFound("Product not found");
    }
    return product;
  }

  async updateProduct(
    id: string,
    updates: {
      name?: string;
      description?: string;
      category?: string;
      pricing?: { usd: number; lbp: number };
      inventory?: { quantity: number; minStockLevel?: number };
      image?: string;
    }
  ): Promise<IProduct> {
    // If category is being updated, check if it exists
    if (updates.category) {
      const categoryExists = await Category.findById(updates.category);
      if (!categoryExists) {
        throw ApiError.notFound("Category not found");
      }
    }

    const product = await Product.findByIdAndUpdate(id, updates, {
      new: true,
      runValidators: true,
    }).populate("category");

    if (!product) {
      throw ApiError.notFound("Product not found");
    }

    return product;
  }

  async updateStock(id: string, quantityChange: number): Promise<IProduct> {
    const product = await Product.findById(id);
    if (!product) {
      throw ApiError.notFound("Product not found");
    }

    const newQuantity = product.inventory.quantity + quantityChange;

    if (newQuantity < 0) {
      throw ApiError.badRequest("Insufficient stock");
    }

    product.inventory.quantity = newQuantity;
    await product.save();

    return await product.populate("category");
  }

  async deleteProduct(id: string): Promise<void> {
    const product = await Product.findByIdAndUpdate(id, { isActive: false });
    if (!product) {
      throw ApiError.notFound("Product not found");
    }
  }

  async getLowStockProducts(): Promise<IProduct[]> {
    return await Product.find({
      isActive: true,
      "inventory.isLowStock": true,
    })
      .populate("category")
      .sort({ "inventory.quantity": 1 });
  }

  async convertPrice(
    amount: number,
    fromCurrency: "USD" | "LBP"
  ): Promise<{ usd: number; lbp: number }> {
    const exchangeRate = config.currency.exchangeRate;

    if (fromCurrency === "USD") {
      return {
        usd: amount,
        lbp: amount * exchangeRate,
      };
    } else {
      return {
        usd: amount / exchangeRate,
        lbp: amount,
      };
    }
  }
}

export default new ProductService();
