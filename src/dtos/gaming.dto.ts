import {
  IsString,
  IsNumber,
  IsOptional,
  IsEnum,
  IsBoolean,
  IsObject,
  IsMongoId,
  Min,
  MaxLength,
  IsNotEmpty,
} from "class-validator";
import { PCStatus } from "../models/pc.model";
import { PaymentMethod, Currency } from "../models/sale.model";

export class CreatePCDto {
  @IsNotEmpty()
  @IsString()
  pcNumber!: string;

  @IsNotEmpty()
  @IsString()
  name!: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  hourlyRateUsd?: number;

  @IsOptional()
  @IsObject()
  specifications?: {
    cpu?: string;
    gpu?: string;
    ram?: string;
    monitor?: string;
  };

  @IsOptional()
  @IsString()
  location?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

export class UpdatePCDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  hourlyRateUsd?: number;

  @IsOptional()
  @IsObject()
  specifications?: {
    cpu?: string;
    gpu?: string;
    ram?: string;
    monitor?: string;
  };

  @IsOptional()
  @IsString()
  location?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;

  @IsOptional()
  @IsEnum(PCStatus)
  status?: PCStatus;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class StartSessionDto {
  @IsNotEmpty()
  @IsMongoId()
  pcId!: string;

  @IsOptional()
  @IsMongoId()
  customerId?: string;

  @IsOptional()
  @IsString()
  customerName?: string;

  @IsOptional()
  @IsMongoId()
  saleId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

export class EndSessionDto {
  @IsOptional()
  @IsMongoId()
  discountId?: string;
}

export class ProcessSessionPaymentDto {
  @IsNotEmpty()
  @IsEnum(PaymentMethod)
  paymentMethod!: PaymentMethod;

  @IsNotEmpty()
  @IsEnum(Currency)
  paymentCurrency!: Currency;

  @IsNotEmpty()
  @IsNumber()
  @Min(0)
  amount!: number;
}
