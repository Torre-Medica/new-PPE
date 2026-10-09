import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class SimulateQrScanDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(512)
  qrCode!: string;
}
