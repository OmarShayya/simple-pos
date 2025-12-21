import mongoose, { Schema, Document, Types } from "mongoose";

export enum SessionStatus {
  ACTIVE = "active",
  COMPLETED = "completed",
  CANCELLED = "cancelled",
}

export enum SessionPaymentStatus {
  UNPAID = "unpaid",
  PAID = "paid",
  PARTIAL = "partial",
}

export interface IGamingSession extends Document {
  _id: Types.ObjectId;
  sessionNumber: string;
  pc: Types.ObjectId | any;
  customer?: Types.ObjectId | any;
  customerName?: string;
  startTime: Date;
  endTime?: Date;
  duration?: number; // in minutes
  hourlyRate: {
    usd: number;
    lbp: number;
  };
  discount?: {
    discountId: Types.ObjectId;
    discountName: string;
    percentage: number;
    amount: {
      usd: number;
      lbp: number;
    };
  };
  totalCost: {
    usd: number;
    lbp: number;
  };
  finalAmount: {
    usd: number;
    lbp: number;
  };
  status: SessionStatus;
  paymentStatus: SessionPaymentStatus;
  sale?: Types.ObjectId;
  startedBy: Types.ObjectId | any;
  endedBy?: Types.ObjectId | any;
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}

const gamingSessionSchema = new Schema<IGamingSession>(
  {
    sessionNumber: {
      type: String,
      required: true,
      unique: true,
    },
    pc: {
      type: Schema.Types.ObjectId,
      ref: "PC",
      required: [true, "PC is required"],
    },
    customer: {
      type: Schema.Types.ObjectId,
      ref: "Customer",
    },
    customerName: {
      type: String,
      trim: true,
    },
    startTime: {
      type: Date,
      required: true,
      default: Date.now,
    },
    endTime: {
      type: Date,
    },
    duration: {
      type: Number, // in minutes
      min: 0,
    },
    hourlyRate: {
      usd: {
        type: Number,
        required: true,
        min: 0,
      },
      lbp: {
        type: Number,
        required: true,
        min: 0,
      },
    },
    discount: {
      discountId: { type: Schema.Types.ObjectId, ref: "Discount" },
      discountName: { type: String },
      percentage: { type: Number, min: 0, max: 100 },
      amount: {
        usd: { type: Number, default: 0 },
        lbp: { type: Number, default: 0 },
      },
    },
    totalCost: {
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
    finalAmount: {
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
    status: {
      type: String,
      enum: Object.values(SessionStatus),
      default: SessionStatus.ACTIVE,
    },
    paymentStatus: {
      type: String,
      enum: Object.values(SessionPaymentStatus),
      default: SessionPaymentStatus.UNPAID,
    },
    sale: {
      type: Schema.Types.ObjectId,
      ref: "Sale",
    },
    startedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    endedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
    },
    notes: {
      type: String,
      trim: true,
      maxlength: 500,
    },
  },
  {
    timestamps: true,
  }
);

gamingSessionSchema.index({ pc: 1 });
gamingSessionSchema.index({ customer: 1 });
gamingSessionSchema.index({ status: 1 });
gamingSessionSchema.index({ startTime: -1 });
gamingSessionSchema.index({ paymentStatus: 1 });

export default mongoose.model<IGamingSession>(
  "GamingSession",
  gamingSessionSchema
);
