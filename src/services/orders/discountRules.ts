import { Types } from "mongoose";
import Discount, { DiscountTarget, IDiscount } from "../../models/discount.model";
import { IAppliedDiscount } from "../../models/sale.model";
import { ApiError } from "../../utils/apiError";

/**
 * Looks up a discount and checks it may be applied where the caller wants it.
 * Returns the discount as it is stored on an order line (amount is priced later from the percentage).
 */
export type DiscountPlacement =
  | { on: "product"; productId: string; categoryId?: string; productName: string }
  | { on: "gaming" }
  | { on: "order" };

const toApplied = (d: IDiscount): IAppliedDiscount => ({
  discountId: d._id,
  discountName: d.name,
  percentage: d.value,
  amount: { usd: 0, lbp: 0 },
});

export const resolveDiscount = async (discountId: string, placement: DiscountPlacement): Promise<IAppliedDiscount> => {
  if (!Types.ObjectId.isValid(discountId)) throw ApiError.notFound(`Discount ${discountId} not found`);
  const discount = await Discount.findById(discountId);
  if (!discount) throw ApiError.notFound(`Discount ${discountId} not found`);
  if (!discount.isActive) throw ApiError.badRequest(`Discount ${discount.name} is not active`);
  const now = Date.now();
  if (discount.startDate && discount.startDate.getTime() > now) {
    throw ApiError.badRequest(`Discount ${discount.name} has not started yet`);
  }
  if (discount.endDate && discount.endDate.getTime() < now) {
    throw ApiError.badRequest(`Discount ${discount.name} has expired`);
  }

  switch (placement.on) {
    case "product": {
      const targetId = discount.targetId?.toString();
      const fits =
        (discount.target === DiscountTarget.PRODUCT && targetId === placement.productId) ||
        (discount.target === DiscountTarget.CATEGORY && targetId === placement.categoryId);
      if (fits) break;
      if (discount.target === DiscountTarget.PRODUCT || discount.target === DiscountTarget.CATEGORY) {
        throw ApiError.badRequest(`Discount ${discount.name} is not applicable to product ${placement.productName}`);
      }
      throw ApiError.badRequest(`Discount ${discount.name} cannot be applied to individual items`);
    }
    case "gaming":
      if (discount.target !== DiscountTarget.GAMING_SESSION) {
        throw ApiError.badRequest(`Discount ${discount.name} cannot be applied to gaming sessions`);
      }
      break;
    case "order":
      if (discount.target !== DiscountTarget.SALE) {
        throw ApiError.badRequest(`Discount ${discount.name} cannot be applied to entire sale`);
      }
      break;
  }
  return toApplied(discount);
};
