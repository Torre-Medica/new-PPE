import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { KioskController } from '@modules/kiosk/interfaces/http/kiosk.controller';
import { KioskEventsService } from '@modules/kiosk/application/kiosk-events.service';
import { KioskStateService } from '@modules/kiosk/application/kiosk-state.service';
import { PaymentCoreModule } from '@modules/payment-core/payment-core.module';
import { PrintingModule } from '@modules/printing/printing.module';
import { KioskStateEntity } from '@modules/persistence/infrastructure/entities/kiosk-state.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([KioskStateEntity]),
    forwardRef(() => PaymentCoreModule),
    forwardRef(() => PrintingModule),
  ],
  controllers: [KioskController],
  providers: [KioskEventsService, KioskStateService],
  exports: [KioskEventsService, KioskStateService],
})
export class KioskModule {}
