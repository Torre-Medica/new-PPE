import { IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class RegisterCashDto {
  @IsInt()
  @Min(1)
  denominationId!: number;

  @IsInt()
  @Min(1)
  quantity!: number;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  createdBy?: string;
}
