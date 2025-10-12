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
  IsUrl,
  ValidateNested,
} from "class-validator";
import { Type } from "class-transformer";

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

  @IsNotEmpty()
  @IsString()
  @MinLength(2)
  @MaxLength(50)
  sku!: string;

  @IsNotEmpty()
  @IsMongoId()
  category!: string;

  @IsNotEmpty()
  @ValidateNested()
  @Type(() => PricingDto)
  pricing!: PricingDto;

  @IsNotEmpty()
  @ValidateNested()
  @Type(() => InventoryDto)
  inventory!: InventoryDto;

  @IsOptional()
  @IsUrl()
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
  @ValidateNested()
  @Type(() => PricingDto)
  pricing?: PricingDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => InventoryDto)
  inventory?: InventoryDto;

  @IsOptional()
  @IsUrl()
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
