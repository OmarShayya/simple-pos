import mongoose, { Schema, Document, Types } from "mongoose";

export interface IExchangeRate extends Document {
  _id: Types.ObjectId;
  rate: number;
  previousRate?: number;
  updatedBy: Types.ObjectId;
  effectiveFrom: Date;
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}

const exchangeRateSchema = new Schema<IExchangeRate>(
  {
    rate: {
      type: Number,
      required: [true, "Exchange rate is required"],
      min: [0, "Rate must be positive"],
    },
    previousRate: {
      type: Number,
    },
    updatedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    effectiveFrom: {
      type: Date,
      default: Date.now,
    },
    notes: {
      type: String,
      maxlength: 500,
    },
  },
  {
    timestamps: true,
  }
);

exchangeRateSchema.index({ createdAt: -1 });

export default mongoose.model<IExchangeRate>(
  "ExchangeRate",
  exchangeRateSchema
);
