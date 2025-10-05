import {
  IsNotEmpty,
  IsNumber,
  Min,
  IsOptional,
  IsString,
  MaxLength,
} from "class-validator";

export class UpdateExchangeRateDto {
  @IsNotEmpty()
  @IsNumber()
  @Min(0)
  rate!: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}
