import Discount, {
  IDiscount,
  DiscountTarget,
  DiscountType,
} from "../models/discount.model";
import Product from "../models/product.model";
import Category from "../models/category.model";
import { ApiError } from "../utils/apiError";

interface DiscountFilters {
  target?: DiscountTarget;
  isActive?: boolean;
  targetId?: string;
  page?: number;
  limit?: number;
}

interface CreateDiscountData {
  name: string;
  description?: string;
  value: number;
  target: DiscountTarget;
  targetId?: string;
  isActive?: boolean;
  startDate?: Date;
  endDate?: Date;
}

class DiscountService {
  async createDiscount(
    userId: string,
    data: CreateDiscountData
  ): Promise<IDiscount> {
    // Validate target and targetId combination
    if (
      data.target === DiscountTarget.PRODUCT ||
      data.target === DiscountTarget.CATEGORY
    ) {
      if (!data.targetId) {
        throw ApiError.badRequest(
          `targetId is required for ${data.target} discounts`
        );
      }

      // Verify the target exists
      if (data.target === DiscountTarget.PRODUCT) {
        const product = await Product.findById(data.targetId);
        if (!product) {
          throw ApiError.notFound("Product not found");
        }
      } else if (data.target === DiscountTarget.CATEGORY) {
        const category = await Category.findById(data.targetId);
        if (!category) {
          throw ApiError.notFound("Category not found");
        }
      }
    } else {
      // For SALE and GAMING_SESSION, targetId should be null
      if (data.targetId) {
        throw ApiError.badRequest(
          `targetId should not be provided for ${data.target} discounts`
        );
      }
    }

    const discount = await Discount.create({
      ...data,
      type: DiscountType.PERCENTAGE,
      createdBy: userId,
    });

    return await discount.populate("createdBy", "name email");
  }

  async updateDiscount(
    discountId: string,
    data: Partial<CreateDiscountData>
  ): Promise<IDiscount> {
    const discount = await Discount.findById(discountId);
    if (!discount) {
      throw ApiError.notFound("Discount not found");
    }

    // If updating target or targetId, validate the new combination
    const newTarget = data.target || discount.target;
    const newTargetId = data.targetId !== undefined ? data.targetId : discount.targetId?.toString();

    if (
      newTarget === DiscountTarget.PRODUCT ||
      newTarget === DiscountTarget.CATEGORY
    ) {
      if (!newTargetId) {
        throw ApiError.badRequest(
          `targetId is required for ${newTarget} discounts`
        );
      }

      if (newTarget === DiscountTarget.PRODUCT) {
        const product = await Product.findById(newTargetId);
        if (!product) {
          throw ApiError.notFound("Product not found");
        }
      } else if (newTarget === DiscountTarget.CATEGORY) {
        const category = await Category.findById(newTargetId);
        if (!category) {
          throw ApiError.notFound("Category not found");
        }
      }
    } else {
      if (newTargetId) {
        throw ApiError.badRequest(
          `targetId should not be provided for ${newTarget} discounts`
        );
      }
    }

    Object.assign(discount, data);
    await discount.save();

    return await discount.populate("createdBy", "name email");
  }

  async getDiscountById(discountId: string): Promise<IDiscount> {
    const discount = await Discount.findById(discountId)
      .populate("createdBy", "name email")
      .populate("targetId");

    if (!discount) {
      throw ApiError.notFound("Discount not found");
    }

    return discount;
  }

  async getAllDiscounts(filters: DiscountFilters): Promise<{
    discounts: IDiscount[];
    total: number;
    page: number;
    totalPages: number;
  }> {
    const { target, isActive, targetId, page = 1, limit = 20 } = filters;

    const query: any = {};

    if (target) {
      query.target = target;
    }

    if (isActive !== undefined) {
      query.isActive = isActive;
    }

    if (targetId) {
      query.targetId = targetId;
    }

    const skip = (page - 1) * limit;

    const [discounts, total] = await Promise.all([
      Discount.find(query)
        .populate("createdBy", "name email")
        .populate("targetId")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      Discount.countDocuments(query),
    ]);

    return {
      discounts,
      total,
      page,
      totalPages: Math.ceil(total / limit),
    };
  }

  async deleteDiscount(discountId: string): Promise<void> {
    const discount = await Discount.findById(discountId);
    if (!discount) {
      throw ApiError.notFound("Discount not found");
    }

    await discount.deleteOne();
  }

  async getActiveDiscountsForProduct(productId: string): Promise<IDiscount[]> {
    const product = await Product.findById(productId);
    if (!product) {
      throw ApiError.notFound("Product not found");
    }

    const now = new Date();

    // Get discounts for the specific product and its category
    const discounts = await Discount.find({
      $and: [
        {
          $or: [
            { target: DiscountTarget.PRODUCT, targetId: productId },
            { target: DiscountTarget.CATEGORY, targetId: product.category },
          ],
        },
        { isActive: true },
        {
          $or: [{ startDate: { $exists: false } }, { startDate: { $lte: now } }],
        },
        {
          $or: [{ endDate: { $exists: false } }, { endDate: { $gte: now } }],
        },
      ],
    }).sort({ value: -1 }); // Sort by highest discount first

    return discounts;
  }

  async getActiveDiscountsForGamingSession(): Promise<IDiscount[]> {
    const now = new Date();

    const discounts = await Discount.find({
      $and: [
        { target: DiscountTarget.GAMING_SESSION },
        { isActive: true },
        {
          $or: [{ startDate: { $exists: false } }, { startDate: { $lte: now } }],
        },
        {
          $or: [{ endDate: { $exists: false } }, { endDate: { $gte: now } }],
        },
      ],
    }).sort({ value: -1 });

    return discounts;
  }

  async getActiveDiscountsForSale(): Promise<IDiscount[]> {
    const now = new Date();

    const discounts = await Discount.find({
      $and: [
        { target: DiscountTarget.SALE },
        { isActive: true },
        {
          $or: [{ startDate: { $exists: false } }, { startDate: { $lte: now } }],
        },
        {
          $or: [{ endDate: { $exists: false } }, { endDate: { $gte: now } }],
        },
      ],
    }).sort({ value: -1 });

    return discounts;
  }

  calculateDiscountAmount(
    amount: { usd: number; lbp: number },
    percentage: number
  ): { usd: number; lbp: number } {
    return {
      usd: Math.round((amount.usd * percentage) / 100 * 100) / 100,
      lbp: Math.round((amount.lbp * percentage) / 100),
    };
  }
}

export default new DiscountService();
