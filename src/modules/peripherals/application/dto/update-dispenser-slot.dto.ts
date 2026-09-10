import { IsBoolean, IsInt, IsOptional, Min } from 'class-validator';

export class UpdateDispenserSlotDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  denominationId?: number | null;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  quantity?: number;
}
