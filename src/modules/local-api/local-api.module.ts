import { Module } from '@nestjs/common';
import { CashManagementModule } from '@modules/cash-management/cash-management.module';
import { HealthController } from '@modules/local-api/interfaces/http/health.controller';
import { DispenserSlotsController } from '@modules/local-api/interfaces/http/dispenser-slots.controller';
import { PaymentCoreModule } from '@modules/payment-core/payment-core.module';
import { PeripheralsModule } from '@modules/peripherals/peripherals.module';
import { ServerLinkModule } from '@modules/server-link/server-link.module';
import { DispenserSlotMovementSyncService } from '@modules/local-api/application/dispenser-slot-movement-sync.service';

@Module({
  imports: [CashManagementModule, PaymentCoreModule, PeripheralsModule, ServerLinkModule],
  controllers: [HealthController, DispenserSlotsController],
  providers: [DispenserSlotMovementSyncService],
})
export class LocalApiModule {}
