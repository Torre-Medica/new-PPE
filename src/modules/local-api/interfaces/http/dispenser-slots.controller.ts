import {
  Body,
  ConflictException,
  Controller,
  Get,
  Logger,
  Param,
  Patch,
  Post,
  UseFilters,
} from '@nestjs/common';
import { DomainExceptionFilter } from '@common/errors/domain-exception.filter';
import { LocalApiRole } from '@common/security/local-api-role.enum';
import { Roles } from '@common/security/roles.decorator';
import { CashInventoryService } from '@modules/cash-management/application/cash-inventory.service';
import { CollectorTestControlDto } from '@modules/local-api/interfaces/http/dto/collector-test-control.dto';
import { EjectDispenserDto } from '@modules/local-api/interfaces/http/dto/eject-dispenser.dto';
import { SlotCashAdjustmentDto } from '@modules/local-api/interfaces/http/dto/slot-cash-adjustment.dto';
import { PaymentSessionService } from '@modules/payment-core/application/payment-session.service';
import { UpdateDispenserSlotDto } from '@modules/peripherals/application/dto/update-dispenser-slot.dto';
import { DispenserSlotService } from '@modules/peripherals/application/dispenser-slot.service';
import { PeripheralsService } from '@modules/peripherals/application/peripherals.service';

@UseFilters(DomainExceptionFilter)
@Controller('dispensers')
export class DispenserSlotsController {
  private readonly logger = new Logger(DispenserSlotsController.name);

  constructor(
    private readonly cashInventoryService: CashInventoryService,
    private readonly dispenserSlotService: DispenserSlotService,
    private readonly peripheralsService: PeripheralsService,
    private readonly paymentSessionService: PaymentSessionService,
  ) {}

  @Roles(LocalApiRole.Admin, LocalApiRole.Operator, LocalApiRole.Audit)
  @Get('slots')
  getAll() {
    return this.dispenserSlotService.getAll();
  }

  @Roles(LocalApiRole.Admin, LocalApiRole.Operator)
  @Get('collector-test')
  getCollectorTestStatus() {
    return this.peripheralsService.getCollectorTestSnapshot();
  }

  @Roles(LocalApiRole.Admin, LocalApiRole.Operator)
  @Post('collector-test/start')
  async startCollectorTest(@Body() dto: CollectorTestControlDto) {
    const activeSession = await this.paymentSessionService.getActiveSession();
    if (activeSession) {
      throw new ConflictException(
        `No se puede activar prueba de receptores durante una sesion de pago activa (${activeSession.id} - ${activeSession.status})`,
      );
    }

    return this.peripheralsService.startCollectorTestMode(dto.initiatedBy ?? 'admin');
  }

  @Roles(LocalApiRole.Admin, LocalApiRole.Operator)
  @Post('collector-test/stop')
  stopCollectorTest(@Body() dto: CollectorTestControlDto) {
    return this.peripheralsService.stopCollectorTestMode(dto.initiatedBy ?? 'admin');
  }

  @Roles(LocalApiRole.Admin, LocalApiRole.Operator)
  @Patch('slots/:key')
  async update(@Param('key') key: string, @Body() dto: UpdateDispenserSlotDto) {
    const updated = await this.dispenserSlotService.update(key, dto);
    this.paymentSessionService.syncCashInventoryToNexoBack();
    return updated;
  }

  @Roles(LocalApiRole.Admin, LocalApiRole.Operator)
  @Post('slots/:key/load')
  async loadSlot(@Param('key') key: string, @Body() dto: SlotCashAdjustmentDto) {
    const updated = await this.cashInventoryService.loadDispenserSlot(key, dto);

    this.logger.log(
      `[SLOT LOAD] slot=${key} denom=${updated.denominationId} qty=+${dto.quantity} ` +
      `cantidad final=${updated.quantity} createdBy=${dto.createdBy ?? 'admin'}`,
    );

    this.paymentSessionService.syncCashInventoryToNexoBack();
    return updated;
  }

  @Roles(LocalApiRole.Admin, LocalApiRole.Operator)
  @Post('slots/:key/unload')
  async unloadSlot(@Param('key') key: string, @Body() dto: SlotCashAdjustmentDto) {
    const updated = await this.cashInventoryService.unloadDispenserSlot(key, dto);

    this.logger.log(
      `[SLOT UNLOAD] slot=${key} denom=${updated.denominationId} qty=-${dto.quantity} ` +
      `cantidad final=${updated.quantity} createdBy=${dto.createdBy ?? 'admin'}`,
    );

    this.paymentSessionService.syncCashInventoryToNexoBack();
    return updated;
  }

  @Roles(LocalApiRole.Admin, LocalApiRole.Operator)
  @Post('eject')
  async eject(@Body() dto: EjectDispenserDto): Promise<{
    slotKey: string;
    denominationId: number;
    quantity: number;
    totalDispensed: number;
  }> {
    const activeSession = await this.paymentSessionService.getActiveSession();
    if (activeSession) {
      throw new ConflictException(
        `No se puede expulsar efectivo durante una sesion de pago activa (${activeSession.id} - ${activeSession.status})`,
      );
    }

    const result = await this.cashInventoryService.ejectFromDispenserSlot(
      dto.slotKey,
      dto.quantity ?? 1,
    );

    this.logger.log(
      `[EJECT] slot=${result.slotKey} denominacion=${result.denominationId} ` +
      `cantidad=${result.quantity} total=${result.totalDispensed}`,
    );

    this.paymentSessionService.syncCashInventoryToNexoBack();
    return result;
  }
}
