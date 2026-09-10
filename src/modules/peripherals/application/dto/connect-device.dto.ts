import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { DeviceType } from '@modules/persistence/infrastructure/entities/device.entity';

export class ConnectDeviceDto {
  @IsEnum(DeviceType)
  type!: DeviceType;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  port?: string;
}
