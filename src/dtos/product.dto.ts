import {
  IsNotEmpty,
  IsOptional,
  IsString,
  IsNumber,
  IsBoolean,
  Min,
  MaxLength,
  MinLength,
  IsMongoId,
  ValidateNested,
  IsEnum,
} from "class-validator";
import { Type } from "class-transformer";

// Product types enum (must match the model)
export enum ProductType {
  PHYSICAL = "physical",
  SERVICE = "service",
}

class PricingDto {
  @IsNotEmpty()
  @IsNumber()
  @Min(0)
  usd!: number;

  @IsNotEmpty()
  @IsNumber()
  @Min(0)
  lbp!: number;
}

class InventoryDto {
  @IsNotEmpty()
  @IsNumber()
  @Min(0)
  quantity!: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  minStockLevel?: number;
}

export class CreateProductDto {
  @IsNotEmpty()
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  // SKU is optional - required only for physical products (validated in service)
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(50)
  sku?: string;

  @IsNotEmpty()
  @IsMongoId()
  category!: string;

  // Product type - defaults to physical
  @IsOptional()
  @IsEnum(ProductType, { message: "productType must be either 'physical' or 'service'" })
  productType?: ProductType;

  // Pricing is optional - required only for physical products (validated in service)
  @IsOptional()
  @ValidateNested()
  @Type(() => PricingDto)
  pricing?: PricingDto;

  // Inventory is optional - only for physical products
  @IsOptional()
  @ValidateNested()
  @Type(() => InventoryDto)
  inventory?: InventoryDto;

  @IsOptional()
  @IsString()
  image?: string;

  @IsOptional()
  @IsBoolean()
  displayOnMenu?: boolean;
}

export class UpdateProductDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsOptional()
  @IsMongoId()
  category?: string;

  @IsOptional()
  @IsEnum(ProductType, { message: "productType must be either 'physical' or 'service'" })
  productType?: ProductType;

  @IsOptional()
  @ValidateNested()
  @Type(() => PricingDto)
  pricing?: PricingDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => InventoryDto)
  inventory?: InventoryDto;

  @IsOptional()
  @IsString()
  image?: string;

  @IsOptional()
  @IsBoolean()
  displayOnMenu?: boolean;
}

export class UpdateStockDto {
  @IsNotEmpty()
  @IsNumber()
  quantity!: number;
}
