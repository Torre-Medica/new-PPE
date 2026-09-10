import { IsDateString, IsEnum, IsInt, IsOptional, IsString, IsUUID, MaxLength, Min } from 'class-validator';
import { PaymentSessionStatus } from '@modules/persistence/infrastructure/entities/payment-session.entity';

export class QueryCompletedPaymentsDto {
  @IsOptional()
  @IsString()
  @MaxLength(512)
  qrCode?: string;

  @IsOptional()
  @IsUUID()
  ppeTransactionUuid?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  serverPaymentId?: number;

  @IsOptional()
  @IsEnum(PaymentSessionStatus)
  status?: PaymentSessionStatus;

  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @IsOptional()
  @IsDateString()
  dateTo?: string;
}
