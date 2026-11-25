import mongoose, { Schema, Document, Types } from "mongoose";
import { StationType } from "./pc.model";

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

/** Where the order was placed. */
export enum OrderSource {
  POS = "pos",
  WEBSITE = "website",
}

/** What a line on the order is: a product from the menu or time on a gaming station. */
export enum SaleItemKind {
  PRODUCT = "product",
  GAMING = "gaming",
}

export interface IAmount {
  usd: number;
  lbp: number;
}

export interface IAppliedDiscount {
  discountId: Types.ObjectId;
  discountName: string;
  percentage: number;
  amount: IAmount;
}

export interface ISaleItemStation {
  id: Types.ObjectId;
  pcNumber: string;
  name: string;
  type: StationType;
}

export interface ISaleItem {
  kind: SaleItemKind;
  /** Product ref (product lines only). Legacy gaming lines wrongly stored the station id here. */
  product?: Types.ObjectId | any;
  /** "Pepsi" — or for gaming lines "PC-05 · 1h 30m" */
  productName: string;
  /** Optional — service products don't have SKUs. Gaming lines use "SESSION-<sessionNumber>". */
  productSku?: string;
  quantity: number;
  unitPrice: IAmount;
  discount?: IAppliedDiscount;
  subtotal: IAmount;
  finalAmount: IAmount;
  /** Gaming lines only */
  gamingSession?: Types.ObjectId;
  station?: ISaleItemStation;
  durationMinutes?: number;
}

export interface ISale extends Document {
  _id: Types.ObjectId;
  invoiceNumber: string;
  source: OrderSource;
  customer?: Types.ObjectId | any; // Can be ObjectId or populated Customer
  /** Snapshot of who the order is for (customer name, or the name typed when starting a session). */
  customerName?: string;
  items: ISaleItem[];
  subtotalBeforeDiscount: IAmount;
  saleDiscount?: IAppliedDiscount;
  totalItemDiscounts: IAmount;
  totals: IAmount;
  paymentMethod?: PaymentMethod;
  paymentCurrency?: Currency;
  amountPaid: IAmount;
  status: SaleStatus;
  /** Staff member who created the order. Website orders have none. */
  cashier?: Types.ObjectId | any;
  /** Staff member who took the payment. */
  paidBy?: Types.ObjectId | any;
  notes?: string;
  paidAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

/** Plain (lean / toObject) shape of an order. */
export type SaleRecord = Omit<ISale, keyof Document> & { _id: Types.ObjectId };

const amountSchema = {
  usd: { type: Number, required: true },
  lbp: { type: Number, required: true },
};

/** Optional sub-document: absent when no discount is applied (older rows may hold an empty shell). */
const discountSchema = {
  type: new Schema<IAppliedDiscount>(
    {
      discountId: { type: Schema.Types.ObjectId, ref: "Discount" },
      discountName: { type: String },
      percentage: { type: Number, min: 0, max: 100 },
      amount: {
        usd: { type: Number, default: 0 },
        lbp: { type: Number, default: 0 },
      },
    },
    { _id: false }
  ),
  required: false,
};

const saleItemSchema = new Schema<ISaleItem>(
  {
    kind: {
      type: String,
      enum: Object.values(SaleItemKind),
      default: SaleItemKind.PRODUCT,
    },
    product: {
      type: Schema.Types.ObjectId,
      ref: "Product",
      required: function (this: ISaleItem) {
        return this.kind !== SaleItemKind.GAMING;
      },
    },
    productName: {
      type: String,
      required: true,
    },
    productSku: {
      type: String,
      required: false, // Optional - service products don't have SKUs
    },
    quantity: {
      type: Number,
      required: true,
      min: 1,
    },
    unitPrice: amountSchema,
    discount: discountSchema,
    subtotal: amountSchema,
    finalAmount: amountSchema,
    gamingSession: { type: Schema.Types.ObjectId, ref: "GamingSession" },
    station: {
      type: new Schema<ISaleItemStation>(
        {
          id: { type: Schema.Types.ObjectId, ref: "PC" },
          pcNumber: { type: String },
          name: { type: String },
          type: { type: String, enum: Object.values(StationType) },
        },
        { _id: false }
      ),
      required: false,
    },
    durationMinutes: { type: Number, min: 0 },
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
    source: {
      type: String,
      enum: Object.values(OrderSource),
      default: OrderSource.POS,
    },
    customer: {
      type: Schema.Types.ObjectId,
      ref: "Customer",
    },
    customerName: { type: String, trim: true, maxlength: 100 },
    items: {
      type: [saleItemSchema],
      required: true,
      validate: {
        validator: (items: ISaleItem[]) => items.length > 0,
        message: "Sale must have at least one item",
      },
    },
    subtotalBeforeDiscount: {
      usd: { type: Number, required: true, min: 0 },
      lbp: { type: Number, required: true, min: 0 },
    },
    saleDiscount: discountSchema,
    totalItemDiscounts: {
      usd: { type: Number, default: 0, min: 0 },
      lbp: { type: Number, default: 0, min: 0 },
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
    },
    paidBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
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

saleSchema.index({ customer: 1 });
saleSchema.index({ status: 1, createdAt: -1 });
saleSchema.index({ source: 1, status: 1 });
saleSchema.index({ createdAt: -1 });
saleSchema.index({ status: 1, paidAt: 1 });
saleSchema.index({ cashier: 1 });
saleSchema.index({ "items.gamingSession": 1 });

export default mongoose.model<ISale>("Sale", saleSchema);
