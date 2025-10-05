import mongoose, { Schema, Document, Types } from "mongoose";

export interface ICustomer extends Document {
  _id: Types.ObjectId;
  name: string;
  email?: string;
  phone: string;
  address?: {
    street?: string;
    city?: string;
    country?: string;
  };
  balance: {
    usd: number;
    lbp: number;
  };
  totalPurchases: number;
  lastPurchaseDate?: Date;
  notes?: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const customerSchema = new Schema<ICustomer>(
  {
    name: {
      type: String,
      required: [true, "Customer name is required"],
      trim: true,
      minlength: 2,
      maxlength: 100,
    },
    email: {
      type: String,
      trim: true,
      lowercase: true,
      sparse: true,
      match: [/^\S+@\S+\.\S+$/, "Please provide a valid email"],
    },
    phone: {
      type: String,
      required: [true, "Phone number is required"],
      trim: true,
    },
    address: {
      street: { type: String, trim: true },
      city: { type: String, trim: true },
      country: { type: String, trim: true },
    },
    balance: {
      usd: {
        type: Number,
        default: 0,
        min: 0,
      },
      lbp: {
        type: Number,
        default: 0,
        min: 0,
      },
    },
    totalPurchases: {
      type: Number,
      default: 0,
      min: 0,
    },
    lastPurchaseDate: {
      type: Date,
    },
    notes: {
      type: String,
      trim: true,
      maxlength: 500,
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

customerSchema.index({ name: "text", email: "text", phone: "text" });
customerSchema.index({ phone: 1 });
customerSchema.index({ email: 1 });

export default mongoose.model<ICustomer>("Customer", customerSchema);
