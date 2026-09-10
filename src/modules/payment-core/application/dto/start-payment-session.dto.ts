import { IsInt, IsOptional, IsString, IsUUID, MaxLength, Min } from 'class-validator';

export class StartPaymentSessionDto {
  @IsInt()
  @Min(1)
  targetAmount!: number;

  @IsOptional()
  @IsString()
  @MaxLength(512)
  qrCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(16)
  vehiclePlate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  vehicleType?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  identificationType?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  identificationCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  concept?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  serverProcessId?: number;

  @IsOptional()
  @IsString()
  metadataJson?: string;
}
