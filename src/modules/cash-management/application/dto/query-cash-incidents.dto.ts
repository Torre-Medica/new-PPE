import { IsDateString, IsInt, IsOptional, Max, Min } from 'class-validator';

export class QueryCashIncidentsDto {
  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(500)
  limit?: number;
}
