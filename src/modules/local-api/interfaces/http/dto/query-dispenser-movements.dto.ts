import { IsDateString, IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';

export class QueryDispenserMovementsDto {
  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;

  @IsOptional()
  @IsIn(['bill1', 'bill2', 'coin1', 'coin2'])
  slotKey?: 'bill1' | 'bill2' | 'coin1' | 'coin2';

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1000)
  limit?: number;
}
