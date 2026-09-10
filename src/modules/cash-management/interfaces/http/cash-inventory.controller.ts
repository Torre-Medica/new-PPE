import { Body, Controller, Get, Post } from '@nestjs/common';
import { CashAdjustmentDto } from '@modules/cash-management/application/dto/cash-adjustment.dto';
import { CreateCashCloseoutDto } from '@modules/cash-management/application/dto/create-cash-closeout.dto';
import { CreateCashIncidentDto } from '@modules/cash-management/application/dto/create-cash-incident.dto';
import { QueryCashIncidentsDto } from '@modules/cash-management/application/dto/query-cash-incidents.dto';
import { QueryCashCloseoutsDto } from '@modules/cash-management/application/dto/query-cash-closeouts.dto';
import { CashInventoryService } from '@modules/cash-management/application/cash-inventory.service';
import { LocalApiRole } from '@common/security/local-api-role.enum';
import { Roles } from '@common/security/roles.decorator';
import { Query } from '@nestjs/common';
import { Param } from '@nestjs/common';
import { PrintingService } from '@modules/printing/application/printing.service';

@Controller('cash')
export class CashInventoryController {
  constructor(
    private readonly cashInventoryService: CashInventoryService,
    private readonly printingService: PrintingService,
  ) {}

  @Roles(LocalApiRole.Admin, LocalApiRole.Operator, LocalApiRole.Audit)
  @Get('denominations')
  getDenominations() {
    return this.cashInventoryService.getDenominations();
  }

  @Roles(LocalApiRole.Admin, LocalApiRole.Operator, LocalApiRole.Audit)
  @Get('inventory')
  getInventory() {
    return this.cashInventoryService.getInventory();
  }

  @Roles(LocalApiRole.Admin, LocalApiRole.Operator, LocalApiRole.Audit)
  @Get('movements')
  getCashMovements() {
    return this.cashInventoryService.getCashMovements();
  }

  @Roles(LocalApiRole.Admin, LocalApiRole.Operator, LocalApiRole.Audit)
  @Get('dashboard')
  getDailyDashboard() {
    return this.cashInventoryService.getDailyDashboard();
  }

  @Roles(LocalApiRole.Admin, LocalApiRole.Operator, LocalApiRole.Audit)
  @Get('closeouts')
  getCashCloseouts(@Query() query: QueryCashCloseoutsDto) {
    return this.cashInventoryService.listCashCloseouts(query);
  }

  @Roles(LocalApiRole.Admin, LocalApiRole.Operator)
  @Post('load')
  loadCash(@Body() dto: CashAdjustmentDto) {
    return this.cashInventoryService.loadCash(dto);
  }

  @Roles(LocalApiRole.Admin, LocalApiRole.Operator)
  @Post('unload')
  unloadCash(@Body() dto: CashAdjustmentDto) {
    return this.cashInventoryService.unloadCash(dto);
  }

  @Roles(LocalApiRole.Admin, LocalApiRole.Operator)
  @Post('closeouts')
  createCashCloseout(@Body() dto: CreateCashCloseoutDto) {
    return this.cashInventoryService.createCashCloseout(dto);
  }

  @Roles(LocalApiRole.Admin, LocalApiRole.Operator)
  @Post('closeouts/:id/print')
  printCashCloseout(@Param('id') closeoutId: number) {
    return this.printingService.printCashCloseout(closeoutId);
  }

  @Roles(LocalApiRole.Admin, LocalApiRole.Operator, LocalApiRole.Audit)
  @Get('incidents')
  getCashIncidents(@Query() query: QueryCashIncidentsDto) {
    return this.cashInventoryService.listCashIncidents({
      from: query.from ? new Date(query.from) : undefined,
      to: query.to ? this.endOfDayIfDateOnly(query.to) : undefined,
      limit: query.limit,
    });
  }

  /**
   * `to=2026-08-28` (sin hora) parsea a medianoche UTC — usado como limite
   * superior con `<=` excluiria casi todo el dia que el usuario pidio. Si viene
   * solo la fecha, se extiende al final de ese dia (23:59:59.999).
   */
  private endOfDayIfDateOnly(value: string): Date {
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      return new Date(`${value}T23:59:59.999Z`);
    }
    return new Date(value);
  }

  @Roles(LocalApiRole.Admin, LocalApiRole.Operator)
  @Post('incidents')
  createCashIncident(@Body() dto: CreateCashIncidentDto) {
    return this.cashInventoryService.recordCashIncident({
      type: dto.type,
      amount: dto.amount,
      denominationId: dto.denominationId ?? null,
      paymentSessionId: dto.paymentSessionId ?? null,
      note: dto.note ?? null,
      createdBy: dto.createdBy ?? 'operator',
    });
  }
}
