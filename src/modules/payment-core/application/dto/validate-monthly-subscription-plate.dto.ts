import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class ValidateMonthlySubscriptionPlateDto {
  @IsString()
  @MaxLength(16)
  plate!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(24)
  monthsForPay?: number;
}
