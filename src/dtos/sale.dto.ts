import {
  ArrayMaxSize,
  IsIn,
  IsInt,
  Length,
  Matches,
  Max,
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
  ValidateIf,
} from "class-validator";
import { Type } from "class-transformer";
import { PaymentMethod, Currency, OrderSource } from "../models/sale.model";
import { IsCalendarDate } from "./validators";

const STATUS_LIST = /^(pending|paid|cancelled)(,(pending|paid|cancelled))*$/;

export class SaleItemDto {
  @IsNotEmpty()
  @IsMongoId()
  productId!: string;

  @IsNotEmpty()
  @IsNumber()
  @Min(1)
  quantity!: number;

  @IsOptional()
  @ValidateIf((o) => o.discountId !== "")
  @IsMongoId()
  discountId?: string;
}

export class SessionDiscountDto {
  /** The gaming line's SKU ("SESSION-…") — or identify it by `gamingSessionId`. */
  @ValidateIf((o) => !o.gamingSessionId)
  @IsNotEmpty()
  @IsString()
  productSku?: string;

  @IsOptional()
  @IsMongoId()
  gamingSessionId?: string;

  @IsOptional()
  @ValidateIf((o) => o.discountId !== "")
  @IsMongoId()
  discountId?: string; // Optional - if not provided, removes discount from this session
}

export class CreateSaleDto {
  @IsOptional()
  @ValidateIf((o) => o.customerId !== "")
  @IsMongoId()
  customerId?: string;

  @IsNotEmpty()
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => SaleItemDto)
  items!: SaleItemDto[];

  @IsOptional()
  @ValidateIf((o) => o.saleDiscountId !== "")
  @IsMongoId()
  saleDiscountId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

export class UpdateSaleDto {
  @IsOptional()
  @ValidateIf((o) => o.customerId !== "")
  @IsMongoId()
  customerId?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SaleItemDto)
  items?: SaleItemDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SessionDiscountDto)
  sessionDiscounts?: SessionDiscountDto[];

  @IsOptional()
  @ValidateIf((o) => o.saleDiscountId !== "")
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

export class PublicOrderItemDto {
  @IsNotEmpty()
  @IsMongoId()
  productId!: string;

  @IsInt()
  @Min(1)
  @Max(50)
  quantity!: number;
}

/** Order placed from the website menu (no auth). Prices are always taken from the database. */
export class PublicOrderDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => PublicOrderItemDto)
  items!: PublicOrderItemDto[];

  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  customerName!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(30)
  customerPhone!: string;

  @IsOptional()
  @IsString()
  @Length(2, 2)
  phoneCountry?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;

  /** Honeypot: real users never fill this hidden field. */
  @IsOptional()
  @IsString()
  website?: string;
}

/** Query of GET /sales (the orders list). */
export class ListOrdersQueryDto {
  @IsOptional()
  @Matches(STATUS_LIST, { message: "status must be pending, paid, cancelled or a comma list of them" })
  status?: string;

  @IsOptional()
  @IsEnum(OrderSource)
  source?: OrderSource;

  @IsOptional()
  @IsIn(["gaming", "products", "mixed"])
  type?: "gaming" | "products" | "mixed";

  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  /** YYYY-MM-DD in the lounge timezone (inclusive) */
  @IsOptional()
  @IsCalendarDate()
  from?: string;

  @IsOptional()
  @IsCalendarDate()
  to?: string;

  /** Older clients: same as from/to */
  @IsOptional()
  @IsCalendarDate()
  startDate?: string;

  @IsOptional()
  @IsCalendarDate()
  endDate?: string;

  @IsOptional()
  @IsMongoId()
  customerId?: string;

  @IsOptional()
  @IsMongoId()
  cashierId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}
