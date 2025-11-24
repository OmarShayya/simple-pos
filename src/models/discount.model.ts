import mongoose, { Schema, Document, Types } from "mongoose";

export enum DiscountType {
  PERCENTAGE = "percentage",
}

export enum DiscountTarget {
  PRODUCT = "product",
  CATEGORY = "category",
  GAMING_SESSION = "gaming_session",
  SALE = "sale",
}

export interface IDiscount extends Document {
  _id: Types.ObjectId;
  name: string;
  description?: string;
  type: DiscountType;
  value: number; // percentage value (e.g., 10 for 10%)
  target: DiscountTarget;
  targetId?: Types.ObjectId; // Product ID or Category ID (null for sale/gaming_session discounts)
  isActive: boolean;
  startDate?: Date;
  endDate?: Date;
  createdBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const discountSchema = new Schema<IDiscount>(
  {
    name: {
      type: String,
      required: [true, "Discount name is required"],
      trim: true,
      minlength: 2,
      maxlength: 100,
    },
    description: {
      type: String,
      trim: true,
      maxlength: 500,
    },
    type: {
      type: String,
      enum: Object.values(DiscountType),
      default: DiscountType.PERCENTAGE,
    },
    value: {
      type: Number,
      required: [true, "Discount value is required"],
      min: [0, "Discount value cannot be negative"],
      max: [100, "Percentage discount cannot exceed 100%"],
    },
    target: {
      type: String,
      enum: Object.values(DiscountTarget),
      required: [true, "Discount target is required"],
    },
    targetId: {
      type: Schema.Types.ObjectId,
      refPath: "targetModel",
      validate: {
        validator: function (this: IDiscount, value: Types.ObjectId) {
          // targetId is required for PRODUCT and CATEGORY targets
          if (
            this.target === DiscountTarget.PRODUCT ||
            this.target === DiscountTarget.CATEGORY
          ) {
            return value != null;
          }
          // targetId should be null for SALE and GAMING_SESSION
          return value == null;
        },
        message:
          "targetId is required for product and category discounts, and must be null for sale and gaming_session discounts",
      },
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    startDate: {
      type: Date,
    },
    endDate: {
      type: Date,
      validate: {
        validator: function (this: IDiscount, value: Date) {
          if (this.startDate && value) {
            return value > this.startDate;
          }
          return true;
        },
        message: "End date must be after start date",
      },
    },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
  },
  {
    timestamps: true,
  }
);

// Virtual field for dynamic reference
discountSchema.virtual("targetModel").get(function (this: IDiscount) {
  if (this.target === DiscountTarget.PRODUCT) return "Product";
  if (this.target === DiscountTarget.CATEGORY) return "Category";
  return null;
});

// Indexes
discountSchema.index({ target: 1, targetId: 1 });
discountSchema.index({ isActive: 1 });
discountSchema.index({ startDate: 1, endDate: 1 });
discountSchema.index({ name: "text", description: "text" });

// Method to check if discount is currently valid
discountSchema.methods.isValid = function (this: IDiscount): boolean {
  if (!this.isActive) return false;

  const now = new Date();

  if (this.startDate && now < this.startDate) return false;
  if (this.endDate && now > this.endDate) return false;

  return true;
};

export default mongoose.model<IDiscount>("Discount", discountSchema);
