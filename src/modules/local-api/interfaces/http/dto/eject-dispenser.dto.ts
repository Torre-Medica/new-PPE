import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';

const VALID_SLOTS = ['bill1', 'bill2', 'coin1', 'coin2'] as const;
type DispenserSlotKey = (typeof VALID_SLOTS)[number];

export class EjectDispenserDto {
  @IsIn(VALID_SLOTS)
  slotKey!: DispenserSlotKey;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(20)
  quantity?: number;
}
