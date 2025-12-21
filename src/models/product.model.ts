import mongoose, { Schema, Document, Types } from "mongoose";

export enum ProductType {
  PHYSICAL = "physical",
  SERVICE = "service",
}

export interface IProduct extends Document {
  _id: Types.ObjectId;
  name: string;
  description?: string;
  sku?: string;
  category: Types.ObjectId;
  productType: ProductType;
  pricing: {
    usd: number;
    lbp: number;
  };
  inventory?: {
    quantity: number;
    minStockLevel: number;
    isLowStock: boolean;
  };
  image?: string;
  displayOnMenu: boolean;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const productSchema = new Schema<IProduct>(
  {
    name: {
      type: String,
      required: [true, "Product name is required"],
      trim: true,
      minlength: 2,
      maxlength: 100,
    },
    description: {
      type: String,
      trim: true,
      maxlength: 500,
    },
    sku: {
      type: String,
      unique: true,
      sparse: true,
      trim: true,
      uppercase: true,
    },
    category: {
      type: Schema.Types.ObjectId,
      ref: "Category",
      required: [true, "Category is required"],
    },
    productType: {
      type: String,
      enum: Object.values(ProductType),
      default: ProductType.PHYSICAL,
    },
    pricing: {
      usd: {
        type: Number,
        default: 0,
        min: [0, "Price cannot be negative"],
      },
      lbp: {
        type: Number,
        default: 0,
        min: [0, "Price cannot be negative"],
      },
    },
    inventory: {
      quantity: {
        type: Number,
        min: [0, "Quantity cannot be negative"],
        default: 0,
      },
      minStockLevel: {
        type: Number,
        default: 10,
        min: [0, "Minimum stock level cannot be negative"],
      },
      isLowStock: {
        type: Boolean,
        default: false,
      },
    },
    image: {
      type: String,
      trim: true,
    },
    displayOnMenu: {
      type: Boolean,
      default: false,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  }
);

productSchema.index({ name: "text", description: "text", sku: "text" });
productSchema.index({ category: 1 });
productSchema.index({ "inventory.isLowStock": 1 });
productSchema.index({ displayOnMenu: 1 });
productSchema.index({ productType: 1 });

// Update low stock status before saving (only for physical products)
productSchema.pre("save", function (next) {
  if (this.productType === ProductType.PHYSICAL && this.inventory) {
    this.inventory.isLowStock =
      this.inventory.quantity <= this.inventory.minStockLevel;
  }
  next();
});

export default mongoose.model<IProduct>("Product", productSchema);
