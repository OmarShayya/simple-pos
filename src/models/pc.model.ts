import mongoose, { Schema, Document, Types } from "mongoose";

export enum PCStatus {
  AVAILABLE = "available",
  OCCUPIED = "occupied",
  MAINTENANCE = "maintenance",
  RESERVED = "reserved",
}

export interface IPC extends Document {
  _id: Types.ObjectId;
  pcNumber: string;
  name: string;
  status: PCStatus;
  hourlyRate: {
    usd: number;
    lbp: number;
  };
  specifications?: {
    cpu?: string;
    gpu?: string;
    ram?: string;
    monitor?: string;
  };
  location?: string;
  notes?: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const pcSchema = new Schema<IPC>(
  {
    pcNumber: {
      type: String,
      required: [true, "PC number is required"],
      unique: true,
      trim: true,
      uppercase: true,
    },
    name: {
      type: String,
      required: [true, "PC name is required"],
      trim: true,
    },
    status: {
      type: String,
      enum: Object.values(PCStatus),
      default: PCStatus.AVAILABLE,
    },
    hourlyRate: {
      usd: {
        type: Number,
        required: [true, "USD hourly rate is required"],
        min: [0, "Rate cannot be negative"],
        default: 2,
      },
      lbp: {
        type: Number,
        required: [true, "LBP hourly rate is required"],
        min: [0, "Rate cannot be negative"],
        default: 180000,
      },
    },
    specifications: {
      cpu: { type: String, trim: true },
      gpu: { type: String, trim: true },
      ram: { type: String, trim: true },
      monitor: { type: String, trim: true },
    },
    location: {
      type: String,
      trim: true,
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

pcSchema.index({ status: 1 });
pcSchema.index({ isActive: 1 });

export default mongoose.model<IPC>("PC", pcSchema);
