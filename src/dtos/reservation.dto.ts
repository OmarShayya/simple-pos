import {
  IsArray,
  IsBoolean,
  IsEmail,
  IsEnum,
  IsIn,
  IsInt,
  IsISO8601,
  IsMongoId,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ArrayMaxSize,
  ArrayMinSize,
  ValidateNested,
  Length,
} from "class-validator";
import { Type } from "class-transformer";
import { StationType } from "../models/pc.model";

export class CreateReservationDto {
  @IsEnum(StationType)
  type!: StationType;

  @IsISO8601()
  start!: string;

  @IsInt()
  @Min(15)
  @Max(1440)
  durationMinutes!: number;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsMongoId({ each: true })
  stationIds?: string[];

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  stationCount?: number;

  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  customerName!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(30)
  customerPhone!: string;

  /** ISO-3166 alpha-2 of the phone number when it's typed without a country code (default "LB"). */
  @IsOptional()
  @IsString()
  @Length(2, 2)
  phoneCountry?: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(120)
  customerEmail?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;

  /** Honeypot: real users never fill this hidden field. */
  @IsOptional()
  @IsString()
  website?: string;
}

export class UpdateReservationDto {
  @IsOptional()
  @IsISO8601()
  start?: string;

  @IsOptional()
  @IsInt()
  @Min(15)
  @Max(1440)
  durationMinutes?: number;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @IsMongoId({ each: true })
  stationIds?: string[];

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  customerName?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(30)
  customerPhone?: string;

  /** ISO-3166 alpha-2 of the phone number when it's typed without a country code (default "LB"). */
  @IsOptional()
  @IsString()
  @Length(2, 2)
  phoneCountry?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  customerEmail?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

export class CancelReservationDto {
  @IsOptional()
  @IsString()
  @MaxLength(300)
  reason?: string;
}

export class CustomerReservationDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(12)
  code!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(30)
  phone!: string;

  /** ISO-3166 alpha-2 of the phone number when it's typed without a country code (default "LB"). */
  @IsOptional()
  @IsString()
  @Length(2, 2)
  phoneCountry?: string;
}

export class CheckInReservationDto {
  /** Deprecated: every session now lives on an order. Accepted and ignored. */
  @IsOptional()
  @IsBoolean()
  createSale?: boolean;
}

export class DayScheduleDto {
  @IsInt()
  @Min(0)
  @Max(6)
  day!: number;

  @IsBoolean()
  closed!: boolean;

  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: "open must be HH:mm" })
  open!: string;

  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: "close must be HH:mm" })
  close!: string;
}

export class UpdateReservationSettingsDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  timezone?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(7)
  @ValidateNested({ each: true })
  @Type(() => DayScheduleDto)
  schedule?: DayScheduleDto[];

  @IsOptional()
  @IsIn([15, 30, 60])
  slotMinutes?: number;

  @IsOptional()
  @IsInt()
  @Min(15)
  @Max(1440)
  minDurationMinutes?: number;

  @IsOptional()
  @IsInt()
  @Min(15)
  @Max(1440)
  maxDurationMinutes?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(90)
  maxAdvanceDays?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1440)
  minLeadMinutes?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(240)
  noShowGraceMinutes?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(120)
  bufferMinutes?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  maxStationsPerBooking?: number;

  @IsOptional()
  @IsArray()
  @IsEnum(StationType, { each: true })
  bookableTypes?: StationType[];
}
