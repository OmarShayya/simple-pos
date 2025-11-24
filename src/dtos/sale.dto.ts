import {
  IsNotEmpty,
  IsOptional,
  IsString,
  IsMongoId,
  IsArray,
  ArrayMinSize,
  ValidateNested,
  IsNumber,
  Min,
  IsEnum,
  MaxLength,
} from "class-validator";
import { Type } from "class-transformer";
import { PaymentMethod, Currency } from "../models/sale.model";

export class SaleItemDto {
  @IsNotEmpty()
  @IsMongoId()
  productId!: string;

  @IsNotEmpty()
  @IsNumber()
  @Min(1)
  quantity!: number;

  @IsOptional()
  @IsMongoId()
  discountId?: string;
}

export class CreateSaleDto {
  @IsOptional()
  @IsMongoId()
  customerId?: string;

  @IsNotEmpty()
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => SaleItemDto)
  items!: SaleItemDto[];

  @IsOptional()
  @IsMongoId()
  saleDiscountId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

export class UpdateSaleDto {
  @IsOptional()
  @IsMongoId()
  customerId?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SaleItemDto)
  items?: SaleItemDto[];

  @IsOptional()
  @IsMongoId()
  saleDiscountId?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class PaySaleDto {
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
