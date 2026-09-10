import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CashChangeService } from '@modules/cash-management/application/cash-change.service';
import { CashInventoryService } from '@modules/cash-management/application/cash-inventory.service';
import { CashInventoryController } from '@modules/cash-management/interfaces/http/cash-inventory.controller';
import { PeripheralsModule } from '@modules/peripherals/peripherals.module';
import { PrintingModule } from '@modules/printing/printing.module';
import { CashCloseoutEntity } from '@modules/persistence/infrastructure/entities/cash-closeout.entity';
import { CashCloseoutLineEntity } from '@modules/persistence/infrastructure/entities/cash-closeout-line.entity';
import { CashIncidentEntity } from '@modules/persistence/infrastructure/entities/cash-incident.entity';
import { CashInventoryEntity } from '@modules/persistence/infrastructure/entities/cash-inventory.entity';
import { CashMovementEntity } from '@modules/persistence/infrastructure/entities/cash-movement.entity';
import { DenominationEntity } from '@modules/persistence/infrastructure/entities/denomination.entity';
import { DeviceEntity } from '@modules/persistence/infrastructure/entities/device.entity';
import { DispenserSlotEntity } from '@modules/persistence/infrastructure/entities/dispenser-slot.entity';
import { KioskStateEntity } from '@modules/persistence/infrastructure/entities/kiosk-state.entity';
import { PaymentSessionEntity } from '@modules/persistence/infrastructure/entities/payment-session.entity';

@Module({
  imports: [
    PeripheralsModule,
    PrintingModule,
    TypeOrmModule.forFeature([
      DenominationEntity,
      CashCloseoutEntity,
      CashCloseoutLineEntity,
      CashInventoryEntity,
      CashMovementEntity,
      CashIncidentEntity,
      DeviceEntity,
      DispenserSlotEntity,
      KioskStateEntity,
      PaymentSessionEntity,
    ]),
  ],
  controllers: [CashInventoryController],
  providers: [CashInventoryService, CashChangeService],
  exports: [CashInventoryService, CashChangeService],
})
export class CashManagementModule {}
