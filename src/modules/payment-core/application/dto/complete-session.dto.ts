import { IsOptional, IsString, MaxLength } from 'class-validator';

export class CompleteSessionDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  committedBy?: string;
}
