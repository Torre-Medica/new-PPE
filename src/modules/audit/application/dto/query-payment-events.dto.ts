import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class QueryPaymentEventsDto {
  @IsOptional()
  @IsString()
  paymentSessionId?: string;

  @IsOptional()
  @IsString()
  type?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(500)
  limit?: number;
}
