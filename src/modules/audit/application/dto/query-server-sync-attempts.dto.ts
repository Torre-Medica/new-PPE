import { IsEnum, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import {
  ServerSyncAttemptStatus,
  ServerSyncAttemptType,
} from '@modules/persistence/infrastructure/entities/server-sync-attempt.entity';

export class QueryServerSyncAttemptsDto {
  @IsOptional()
  @IsString()
  paymentSessionId?: string;

  @IsOptional()
  @IsEnum(ServerSyncAttemptType)
  requestType?: ServerSyncAttemptType;

  @IsOptional()
  @IsEnum(ServerSyncAttemptStatus)
  status?: ServerSyncAttemptStatus;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(500)
  limit?: number;
}
