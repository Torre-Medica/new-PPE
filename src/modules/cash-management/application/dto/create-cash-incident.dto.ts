import { IsEnum, IsInt, IsOptional, IsString, IsUUID, MaxLength, Min } from 'class-validator';
import { CashIncidentType } from '@modules/persistence/infrastructure/entities/cash-incident.entity';

export class CreateCashIncidentDto {
  @IsEnum(CashIncidentType)
  type!: CashIncidentType;

  @IsInt()
  @Min(1)
  amount!: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  denominationId?: number;

  @IsOptional()
  @IsUUID()
  paymentSessionId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  note?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  createdBy?: string;
}
