import mongoose, { Schema, Document, Types } from "mongoose";
import { StationType } from "./pc.model";

export enum ReservationStatus {
  CONFIRMED = "confirmed",
  CHECKED_IN = "checked_in",
  CANCELLED = "cancelled",
  NO_SHOW = "no_show",
}

export enum ReservationSource {
  WEBSITE = "website",
  POS = "pos",
}

/** Statuses that hold the stations (block other bookings). */
export const ACTIVE_RESERVATION_STATUSES = [ReservationStatus.CONFIRMED, ReservationStatus.CHECKED_IN];

export interface IReservation extends Document {
  _id: Types.ObjectId;
  code: string;
  type: StationType;
  stations: Types.ObjectId[] | any[];
  startTime: Date;
  endTime: Date;
  durationMinutes: number;
  customerName: string;
  customerPhone: string;
  /** Last 8 digits of the phone, used to match lookups regardless of formatting / country code */
  phoneKey: string;
  customerEmail?: string;
  notes?: string;
  status: ReservationStatus;
  source: ReservationSource;
  estimatedCost: { usd: number; lbp: number };
  createdBy?: Types.ObjectId | any;
  checkedInAt?: Date;
  checkedInBy?: Types.ObjectId | any;
  sessions: Types.ObjectId[];
  cancelledAt?: Date;
  cancelledBy?: "customer" | "staff";
  cancelReason?: string;
  noShowAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const reservationSchema = new Schema<IReservation>(
  {
    code: { type: String, required: true, unique: true, uppercase: true, trim: true },
    type: { type: String, enum: Object.values(StationType), required: true },
    stations: [{ type: Schema.Types.ObjectId, ref: "PC", required: true }],
    startTime: { type: Date, required: true },
    endTime: { type: Date, required: true },
    durationMinutes: { type: Number, required: true, min: 1 },
    customerName: { type: String, required: true, trim: true, maxlength: 80 },
    customerPhone: { type: String, required: true, trim: true, maxlength: 30 },
    phoneKey: { type: String, required: true, index: true },
    customerEmail: { type: String, trim: true, lowercase: true, maxlength: 120 },
    notes: { type: String, trim: true, maxlength: 500 },
    status: {
      type: String,
      enum: Object.values(ReservationStatus),
      default: ReservationStatus.CONFIRMED,
    },
    source: {
      type: String,
      enum: Object.values(ReservationSource),
      default: ReservationSource.WEBSITE,
    },
    estimatedCost: {
      usd: { type: Number, default: 0, min: 0 },
      lbp: { type: Number, default: 0, min: 0 },
    },
    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
    checkedInAt: { type: Date },
    checkedInBy: { type: Schema.Types.ObjectId, ref: "User" },
    sessions: [{ type: Schema.Types.ObjectId, ref: "GamingSession" }],
    cancelledAt: { type: Date },
    cancelledBy: { type: String, enum: ["customer", "staff"] },
    cancelReason: { type: String, trim: true, maxlength: 300 },
    noShowAt: { type: Date },
  },
  { timestamps: true }
);

reservationSchema.index({ startTime: 1 });
reservationSchema.index({ status: 1, startTime: 1 });
reservationSchema.index({ stations: 1, startTime: 1, endTime: 1 });

export default mongoose.model<IReservation>("Reservation", reservationSchema);
