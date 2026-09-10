import { IsInt, IsOptional, IsString, IsUUID, MaxLength, Min } from 'class-validator';

export class RecordCashEventDto {
  @IsInt()
  @Min(1)
  denominationId!: number;

  @IsInt()
  @Min(1)
  quantity!: number;

  @IsOptional()
  @IsUUID()
  paymentSessionId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  createdBy?: string;
}
