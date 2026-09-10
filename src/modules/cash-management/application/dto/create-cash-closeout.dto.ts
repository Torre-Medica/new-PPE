import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export const CASH_CLOSEOUT_TYPES = ['PARTIAL', 'TOTAL'] as const;
export type CashCloseoutType = (typeof CASH_CLOSEOUT_TYPES)[number];

export class CreateCashCloseoutDto {
  @IsString()
  @MaxLength(120)
  closedBy!: string;

  @IsIn(CASH_CLOSEOUT_TYPES)
  closeoutType!: CashCloseoutType;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  notes?: string;
}
