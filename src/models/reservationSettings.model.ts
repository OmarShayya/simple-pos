import mongoose, { Schema, Document, Types } from "mongoose";
import { StationType } from "./pc.model";

export interface IDaySchedule {
  /** 0 = Sunday … 6 = Saturday */
  day: number;
  closed: boolean;
  /** "HH:mm" local time */
  open: string;
  /** "HH:mm" local time; if <= open it means the next morning */
  close: string;
}

export interface IReservationSettings extends Document {
  _id: Types.ObjectId;
  key: string;
  enabled: boolean;
  timezone: string;
  schedule: IDaySchedule[];
  slotMinutes: number;
  minDurationMinutes: number;
  maxDurationMinutes: number;
  maxAdvanceDays: number;
  minLeadMinutes: number;
  noShowGraceMinutes: number;
  bufferMinutes: number;
  maxStationsPerBooking: number;
  bookableTypes: StationType[];
  updatedBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

export const DEFAULT_SCHEDULE: IDaySchedule[] = [0, 1, 2, 3, 4, 5, 6].map((day) => ({
  day,
  closed: false,
  open: "16:00",
  close: "04:00",
}));

const dayScheduleSchema = new Schema<IDaySchedule>(
  {
    day: { type: Number, required: true, min: 0, max: 6 },
    closed: { type: Boolean, default: false },
    open: { type: String, required: true, match: /^([01]\d|2[0-3]):[0-5]\d$/ },
    close: { type: String, required: true, match: /^([01]\d|2[0-3]):[0-5]\d$/ },
  },
  { _id: false }
);

const reservationSettingsSchema = new Schema<IReservationSettings>(
  {
    key: { type: String, required: true, unique: true, default: "default" },
    enabled: { type: Boolean, default: true },
    timezone: { type: String, default: "Asia/Beirut" },
    schedule: { type: [dayScheduleSchema], default: DEFAULT_SCHEDULE },
    slotMinutes: { type: Number, default: 30, enum: [15, 30, 60] },
    minDurationMinutes: { type: Number, default: 60, min: 15 },
    maxDurationMinutes: { type: Number, default: 300, min: 15 },
    maxAdvanceDays: { type: Number, default: 14, min: 0, max: 90 },
    minLeadMinutes: { type: Number, default: 30, min: 0 },
    noShowGraceMinutes: { type: Number, default: 15, min: 0, max: 240 },
    bufferMinutes: { type: Number, default: 0, min: 0, max: 120 },
    maxStationsPerBooking: { type: Number, default: 6, min: 1, max: 50 },
    bookableTypes: {
      type: [String],
      enum: Object.values(StationType),
      default: [StationType.PC, StationType.PLAYSTATION],
    },
    updatedBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

export default mongoose.model<IReservationSettings>("ReservationSettings", reservationSettingsSchema);
