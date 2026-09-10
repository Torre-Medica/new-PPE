import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DevicesService } from '@modules/peripherals/application/devices.service';
import { DispenserSlotService } from '@modules/peripherals/application/dispenser-slot.service';
import { PeripheralsService } from '@modules/peripherals/application/peripherals.service';
import { PrinterDetectorService } from '@modules/peripherals/application/printer-detector.service';
import { PortResolverService } from '@modules/peripherals/infrastructure/port-resolver.service';
import { DevicesController } from '@modules/peripherals/interfaces/http/devices.controller';
import { DeviceHealthLogEntity } from '@modules/persistence/infrastructure/entities/device-health-log.entity';
import { DeviceEntity } from '@modules/persistence/infrastructure/entities/device.entity';
import { DispenserSlotEntity } from '@modules/persistence/infrastructure/entities/dispenser-slot.entity';

@Module({
  imports: [TypeOrmModule.forFeature([DeviceEntity, DeviceHealthLogEntity, DispenserSlotEntity])],
  controllers: [DevicesController],
  providers: [DevicesService, PeripheralsService, DispenserSlotService, PortResolverService, PrinterDetectorService],
  exports: [DevicesService, PeripheralsService, DispenserSlotService, PortResolverService, PrinterDetectorService],
})
export class PeripheralsModule {}
