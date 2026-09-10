import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditService } from '@modules/audit/application/audit.service';
import { AuditController } from '@modules/audit/interfaces/http/audit.controller';
import { DeviceHealthLogEntity } from '@modules/persistence/infrastructure/entities/device-health-log.entity';
import { PaymentSessionEventEntity } from '@modules/persistence/infrastructure/entities/payment-session-event.entity';
import { ServerSyncAttemptEntity } from '@modules/persistence/infrastructure/entities/server-sync-attempt.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      PaymentSessionEventEntity,
      DeviceHealthLogEntity,
      ServerSyncAttemptEntity,
    ]),
  ],
  controllers: [AuditController],
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
