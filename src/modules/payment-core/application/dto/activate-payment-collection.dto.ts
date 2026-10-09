import { Type } from 'class-transformer';
import { IsBoolean, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';

export class PaymentCollectionElectronicBillingDto {
  @IsBoolean()
  enabled!: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  customerIdentificationNumber?: string;
}

export class ActivatePaymentCollectionDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  initiatedBy?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => PaymentCollectionElectronicBillingDto)
  electronicBilling?: PaymentCollectionElectronicBillingDto;

  // Placa digitada en el kiosko antes de pagar (obligatoria en pagos de visitante)
  @IsOptional()
  @IsString()
  @MaxLength(16)
  vehiclePlate?: string;
}
