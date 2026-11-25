import {
  IsNotEmpty,
  IsOptional,
  IsString,
  IsEmail,
  MaxLength,
  MinLength,
  IsNumber,
  Min,
  ValidateNested,
  Length,
  ValidateIf,
} from "class-validator";
import { Type } from "class-transformer";

class AddressDto {
  /** ISO-3166 alpha-2 ("LB"); a country name is also accepted and mapped to its code. */
  @IsOptional()
  @IsString()
  @MaxLength(60)
  country?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  city?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  area?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  street?: string;
}

export class CreateCustomerDto {
  @IsNotEmpty()
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name!: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  /** E.164 ("+96170123456") or a national number ("70 123 456") with `phoneCountry`. */
  @IsNotEmpty()
  @IsString()
  @MaxLength(30)
  phone!: string;

  @IsOptional()
  @IsString()
  @Length(2, 2)
  phoneCountry?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => AddressDto)
  address?: AddressDto;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

export class UpdateCustomerDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @ValidateIf((o) => o.email !== "")
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(30)
  phone?: string;

  @IsOptional()
  @IsString()
  @Length(2, 2)
  phoneCountry?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => AddressDto)
  address?: AddressDto;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

export class UpdateBalanceDto {
  @IsNotEmpty()
  @IsNumber()
  @Min(0)
  usd!: number;

  @IsNotEmpty()
  @IsNumber()
  @Min(0)
  lbp!: number;
}
