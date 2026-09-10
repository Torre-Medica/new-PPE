import { IsOptional, IsString, MaxLength } from 'class-validator';

export class CollectorTestControlDto {
  @IsOptional()
  @IsString()
  @MaxLength(80)
  initiatedBy?: string;
}
