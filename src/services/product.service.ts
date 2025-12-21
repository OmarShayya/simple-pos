import Product, { IProduct, ProductType } from "../models/product.model";
import Category from "../models/category.model";
import { ApiError } from "../utils/apiError";
import config from "../config/config";

interface ProductFilters {
  category?: string;
  search?: string;
  lowStock?: boolean;
  minPrice?: number;
  maxPrice?: number;
  displayOnMenu?: boolean;
  page?: number;
  limit?: number;
}

class ProductService {
  async createProduct(data: {
    name: string;
    description?: string;
    sku?: string;
    category: string;
    productType?: ProductType;
    pricing?: { usd: number; lbp: number };
    inventory?: { quantity: number; minStockLevel?: number };
    image?: string;
    displayOnMenu?: boolean;
  }): Promise<IProduct> {
    // Check if category exists
    const categoryExists = await Category.findById(data.category);
    if (!categoryExists) {
      throw ApiError.notFound("Category not found");
    }

    const productType = data.productType || ProductType.PHYSICAL;

    // For physical products, SKU is required
    if (productType === ProductType.PHYSICAL) {
      if (!data.sku) {
        throw ApiError.badRequest("SKU is required for physical products");
      }
      // Check if SKU already exists
      const existingSku = await Product.findOne({
        sku: data.sku.toUpperCase(),
      });
      if (existingSku) {
        throw ApiError.conflict("Product with this SKU already exists");
      }
    }

    const productData: any = {
      name: data.name,
      description: data.description,
      category: data.category,
      productType,
      image: data.image,
      displayOnMenu: data.displayOnMenu || false,
    };

    // For physical products, require pricing and inventory
    if (productType === ProductType.PHYSICAL) {
      if (!data.pricing) {
        throw ApiError.badRequest("Pricing is required for physical products");
      }
      productData.sku = data.sku!.toUpperCase();
      productData.pricing = data.pricing;
      productData.inventory = data.inventory || { quantity: 0, minStockLevel: 10 };
    } else {
      // Service products - pricing optional, no inventory tracking
      productData.pricing = data.pricing || { usd: 0, lbp: 0 };
    }

    const product = await Product.create(productData);

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
      displayOnMenu,
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

    // Display on menu filter
    if (displayOnMenu !== undefined) {
      query.displayOnMenu = displayOnMenu;
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

  async getMenuProducts(): Promise<IProduct[]> {
    return await Product.find({
      isActive: true,
      displayOnMenu: true,
    })
      .populate("category")
      .sort({ category: 1, name: 1 });
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
      displayOnMenu?: boolean;
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

    // Service products don't track inventory
    if (product.productType === ProductType.SERVICE) {
      return await product.populate("category");
    }

    if (!product.inventory) {
      throw ApiError.badRequest("Product has no inventory to update");
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
      productType: ProductType.PHYSICAL,
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
