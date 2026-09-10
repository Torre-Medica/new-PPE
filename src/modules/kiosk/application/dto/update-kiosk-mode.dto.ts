import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { KioskMode } from '@modules/persistence/infrastructure/entities/kiosk-state.entity';

export class UpdateKioskModeDto {
  @IsEnum(KioskMode)
  mode!: KioskMode;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  changedBy?: string;
}
