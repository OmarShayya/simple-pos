import mongoose, { Schema, Document, Types } from "mongoose";

export enum SaleStatus {
  PENDING = "pending",
  PAID = "paid",
  CANCELLED = "cancelled",
}

export enum PaymentMethod {
  CASH = "cash",
  CARD = "card",
  BANK_TRANSFER = "bank_transfer",
}

export enum Currency {
  USD = "USD",
  LBP = "LBP",
}

export interface ISaleItem {
  product: Types.ObjectId | any;
  productName: string;
  productSku: string;
  quantity: number;
  unitPrice: {
    usd: number;
    lbp: number;
  };
  subtotal: {
    usd: number;
    lbp: number;
  };
}

export interface ISale extends Document {
  _id: Types.ObjectId;
  invoiceNumber: string;
  customer?: Types.ObjectId | any; // Can be ObjectId or populated Customer
  items: ISaleItem[];
  totals: {
    usd: number;
    lbp: number;
  };
  paymentMethod?: PaymentMethod;
  paymentCurrency?: Currency;
  amountPaid: {
    usd: number;
    lbp: number;
  };
  status: SaleStatus;
  cashier: Types.ObjectId | any; // Can be ObjectId or populated User
  notes?: string;
  paidAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const saleItemSchema = new Schema<ISaleItem>(
  {
    product: {
      type: Schema.Types.ObjectId,
      ref: "Product",
      required: true,
    },
    productName: {
      type: String,
      required: true,
    },
    productSku: {
      type: String,
      required: true,
    },
    quantity: {
      type: Number,
      required: true,
      min: 1,
    },
    unitPrice: {
      usd: { type: Number, required: true },
      lbp: { type: Number, required: true },
    },
    subtotal: {
      usd: { type: Number, required: true },
      lbp: { type: Number, required: true },
    },
  },
  { _id: false }
);

const saleSchema = new Schema<ISale>(
  {
    invoiceNumber: {
      type: String,
      required: true,
      unique: true,
    },
    customer: {
      type: Schema.Types.ObjectId,
      ref: "Customer",
    },
    items: {
      type: [saleItemSchema],
      required: true,
      validate: {
        validator: (items: ISaleItem[]) => items.length > 0,
        message: "Sale must have at least one item",
      },
    },
    totals: {
      usd: { type: Number, required: true, min: 0 },
      lbp: { type: Number, required: true, min: 0 },
    },
    paymentMethod: {
      type: String,
      enum: Object.values(PaymentMethod),
    },
    paymentCurrency: {
      type: String,
      enum: Object.values(Currency),
    },
    amountPaid: {
      usd: { type: Number, default: 0, min: 0 },
      lbp: { type: Number, default: 0, min: 0 },
    },
    status: {
      type: String,
      enum: Object.values(SaleStatus),
      default: SaleStatus.PENDING,
    },
    cashier: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    notes: {
      type: String,
      maxlength: 500,
    },
    paidAt: {
      type: Date,
    },
  },
  {
    timestamps: true,
  }
);

saleSchema.index({ invoiceNumber: 1 });
saleSchema.index({ customer: 1 });
saleSchema.index({ status: 1 });
saleSchema.index({ createdAt: -1 });
saleSchema.index({ cashier: 1 });

export default mongoose.model<ISale>("Sale", saleSchema);
