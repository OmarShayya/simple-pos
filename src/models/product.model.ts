import mongoose, { Schema, Document, Types } from "mongoose";

export interface IProduct extends Document {
  _id: Types.ObjectId;
  name: string;
  description?: string;
  sku: string;
  category: Types.ObjectId;
  pricing: {
    usd: number;
    lbp: number;
  };
  inventory: {
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
      required: [true, "SKU is required"],
      unique: true,
      trim: true,
      uppercase: true,
    },
    category: {
      type: Schema.Types.ObjectId,
      ref: "Category",
      required: [true, "Category is required"],
    },
    pricing: {
      usd: {
        type: Number,
        required: [true, "USD price is required"],
        min: [0, "Price cannot be negative"],
      },
      lbp: {
        type: Number,
        required: [true, "LBP price is required"],
        min: [0, "Price cannot be negative"],
      },
    },
    inventory: {
      quantity: {
        type: Number,
        required: [true, "Quantity is required"],
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
productSchema.index({ sku: 1 });
productSchema.index({ displayOnMenu: 1 });

// Update low stock status before saving
productSchema.pre("save", function (next) {
  this.inventory.isLowStock =
    this.inventory.quantity <= this.inventory.minStockLevel;
  next();
});

export default mongoose.model<IProduct>("Product", productSchema);
