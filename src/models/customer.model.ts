import mongoose, { Schema, Document, Types } from "mongoose";

/** Channel through which we first met the customer. */
export enum CustomerSource {
  POS = "pos",
  WEBSITE = "website",
  RESERVATION = "reservation",
}

export interface ICustomerAddress {
  /** ISO-3166 alpha-2 ("LB"). Older rows may still hold free text until migrated. */
  country?: string;
  city?: string;
  area?: string;
  street?: string;
}

export interface ICustomer extends Document {
  _id: Types.ObjectId;
  name: string;
  /** True while the name is a generated placeholder (customer created from a phone number only). */
  hasPlaceholderName: boolean;
  email?: string;
  /** E.164, e.g. "+96170123456" (legacy rows that couldn't be parsed keep their original text). */
  phone: string;
  /** ISO-3166 alpha-2 of the phone number, e.g. "LB". */
  phoneCountry?: string;
  source: CustomerSource;
  address?: ICustomerAddress;
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
      minlength: 1,
      maxlength: 100,
    },
    hasPlaceholderName: { type: Boolean, default: false },
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
    phoneCountry: { type: String, trim: true, uppercase: true, maxlength: 2 },
    source: {
      type: String,
      enum: Object.values(CustomerSource),
      default: CustomerSource.POS,
    },
    address: {
      country: { type: String, trim: true },
      city: { type: String, trim: true },
      area: { type: String, trim: true },
      street: { type: String, trim: true },
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
// Non-unique on purpose: legacy duplicates may exist; the customer service dedupes on lookup.
customerSchema.index({ phone: 1 });
customerSchema.index({ createdAt: -1 });

export default mongoose.model<ICustomer>("Customer", customerSchema);
