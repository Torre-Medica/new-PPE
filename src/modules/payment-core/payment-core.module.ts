import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CashManagementModule } from '@modules/cash-management/cash-management.module';
import { KioskModule } from '@modules/kiosk/kiosk.module';
import { PaymentSessionService } from '@modules/payment-core/application/payment-session.service';
import { PaymentSessionController } from '@modules/payment-core/interfaces/http/payment-session.controller';
import { PeripheralsModule } from '@modules/peripherals/peripherals.module';
import { CashMovementEntity } from '@modules/persistence/infrastructure/entities/cash-movement.entity';
import { DenominationEntity } from '@modules/persistence/infrastructure/entities/denomination.entity';
import { PaymentLineEntity } from '@modules/persistence/infrastructure/entities/payment-line.entity';
import { PaymentSessionEventEntity } from '@modules/persistence/infrastructure/entities/payment-session-event.entity';
import { PaymentSessionEntity } from '@modules/persistence/infrastructure/entities/payment-session.entity';
import { ServerSyncAttemptEntity } from '@modules/persistence/infrastructure/entities/server-sync-attempt.entity';
import { ServerLinkModule } from '@modules/server-link/server-link.module';

@Module({
  imports: [
    CashManagementModule,
    forwardRef(() => KioskModule),
    PeripheralsModule,
    forwardRef(() => ServerLinkModule),
    TypeOrmModule.forFeature([
      PaymentSessionEntity,
      PaymentSessionEventEntity,
      PaymentLineEntity,
      ServerSyncAttemptEntity,
      CashMovementEntity,
      DenominationEntity,
    ]),
  ],
  controllers: [PaymentSessionController],
  providers: [PaymentSessionService],
  exports: [PaymentSessionService],
})
export class PaymentCoreModule {}
