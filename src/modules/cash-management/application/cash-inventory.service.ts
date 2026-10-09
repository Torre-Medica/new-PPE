import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, IsNull, MoreThanOrEqual, Not, Repository } from 'typeorm';
import { CashAdjustmentDto } from '@modules/cash-management/application/dto/cash-adjustment.dto';
import { CreateCashCloseoutDto } from '@modules/cash-management/application/dto/create-cash-closeout.dto';
import { RecordCashEventDto } from '@modules/cash-management/application/dto/record-cash-event.dto';
import { QueryCashCloseoutsDto } from '@modules/cash-management/application/dto/query-cash-closeouts.dto';
import { CashChangeService } from '@modules/cash-management/application/cash-change.service';
import { CashCloseoutLineEntity } from '@modules/persistence/infrastructure/entities/cash-closeout-line.entity';
import { CashCloseoutEntity } from '@modules/persistence/infrastructure/entities/cash-closeout.entity';
import {
  CashIncidentEntity,
  CashIncidentType,
} from '@modules/persistence/infrastructure/entities/cash-incident.entity';
import { CashInventoryEntity } from '@modules/persistence/infrastructure/entities/cash-inventory.entity';
import {
  CashMovementEntity,
  CashMovementType,
} from '@modules/persistence/infrastructure/entities/cash-movement.entity';
import { DenominationEntity } from '@modules/persistence/infrastructure/entities/denomination.entity';
import {
  DispenserSlotEntity,
  DispenserSlotKey,
} from '@modules/persistence/infrastructure/entities/dispenser-slot.entity';
import { DispenserSlotService } from '@modules/peripherals/application/dispenser-slot.service';
import { PeripheralsService } from '@modules/peripherals/application/peripherals.service';
import { KioskMode, KioskStateEntity } from '@modules/persistence/infrastructure/entities/kiosk-state.entity';
import { PaymentSessionEntity, PaymentSessionStatus } from '@modules/persistence/infrastructure/entities/payment-session.entity';

type CloseoutReceiptRow = {
  item: string;
  quantity?: number | string | null;
  total?: number | string | null;
};

type CloseoutReceiptSection = {
  title: string;
  rows: CloseoutReceiptRow[];
  // Filas que se imprimen despues de un separador, justo antes del TOTAL
  // (ej. transacciones exitosas / canceladas).
  summaryRows?: CloseoutReceiptRow[];
  total?: number | string | null;
};

// Vehiculos de visitante que siempre aparecen en el ticket corto de transacciones,
// aunque no haya pagos de ese tipo en el periodo.
const VISITOR_TRANSACTION_ITEMS = ['Visitante Carro', 'Visitante Moto'];

@Injectable()
export class CashInventoryService {
  private static readonly KIOSK_STATE_SINGLETON_ID = 1;
  private static readonly BILL_DENOMINATIONS = [1000, 2000, 5000, 10000, 20000, 50000, 100000];

  /**
   * Serializa la creacion de cierres de caja en este proceso. Sin esto, dos
   * peticiones de cierre casi simultaneas (doble-tap del operador) pueden leer
   * el mismo "ultimo cierre TOTAL" antes de que cualquiera confirme el suyo,
   * generando dos cierres con las mismas transacciones/montos.
   */
  private closeoutQueue: Promise<unknown> = Promise.resolve();

  constructor(
    @InjectRepository(CashInventoryEntity)
    private readonly cashInventoryRepository: Repository<CashInventoryEntity>,
    @InjectRepository(CashMovementEntity)
    private readonly cashMovementRepository: Repository<CashMovementEntity>,
    @InjectRepository(DenominationEntity)
    private readonly denominationRepository: Repository<DenominationEntity>,
    @InjectRepository(CashCloseoutEntity)
    private readonly cashCloseoutRepository: Repository<CashCloseoutEntity>,
    @InjectRepository(CashCloseoutLineEntity)
    private readonly cashCloseoutLineRepository: Repository<CashCloseoutLineEntity>,
    @InjectRepository(CashIncidentEntity)
    private readonly cashIncidentRepository: Repository<CashIncidentEntity>,
    @InjectRepository(PaymentSessionEntity)
    private readonly paymentSessionRepository: Repository<PaymentSessionEntity>,
    @InjectRepository(KioskStateEntity)
    private readonly kioskStateRepository: Repository<KioskStateEntity>,
    private readonly dataSource: DataSource,
    private readonly cashChangeService: CashChangeService,
    private readonly dispenserSlotService: DispenserSlotService,
    private readonly peripheralsService: PeripheralsService,
  ) {}

  getDenominations() {
    return this.denominationRepository.find({
      where: { isActive: true },
      order: { id: 'ASC' },
    });
  }

  async getInventory() {
    return this.cashInventoryRepository.find({
      where: {
        denomination: {
          isActive: true,
        },
      },
      relations: ['denomination'],
      order: {
        denominationId: 'ASC',
      },
    });
  }

  async getCashMovements() {
    return this.cashMovementRepository.find({
      relations: ['denomination'],
      order: {
        createdAt: 'DESC',
        id: 'DESC',
      },
      take: 100,
    });
  }

  async loadCash(dto: CashAdjustmentDto) {
    return this.applyManualAdjustment(dto, CashMovementType.Load);
  }

  async unloadCash(dto: CashAdjustmentDto) {
    return this.applyManualAdjustment(dto, CashMovementType.Unload);
  }

  async recordMovementOnly(
    dto: CashAdjustmentDto,
    movementType: CashMovementType.Load | CashMovementType.Unload | CashMovementType.Adjustment,
    reasonOverride?: string,
    manager?: EntityManager,
    slotKey?: DispenserSlotKey,
  ) {
    const denominationRepo = manager
      ? manager.getRepository(DenominationEntity)
      : this.denominationRepository;
    const movementRepo = manager ? manager.getRepository(CashMovementEntity) : this.cashMovementRepository;

    const denomination = await denominationRepo.findOne({
      where: { id: dto.denominationId, isActive: true },
    });

    if (!denomination) {
      throw new NotFoundException(`No existe la denominacion ${dto.denominationId}`);
    }

    const movement = movementRepo.create({
      type: movementType,
      denominationId: dto.denominationId,
      quantity: dto.quantity,
      unitValue: denomination.id,
      totalValue: denomination.id * dto.quantity,
      reason:
        reasonOverride ??
        dto.reason ??
        `Movimiento ${movementType.toLowerCase()} de denominacion ${dto.denominationId}`,
      paymentSessionId: null,
      createdBy: dto.createdBy ?? 'system',
      slotKey: slotKey ?? null,
    });

    return movementRepo.save(movement);
  }

  async getDailyDashboard() {
    const [dispenserSlots, kioskState, lastCloseoutList, lastTotalCloseoutList] = await Promise.all([
      this.dispenserSlotService.getAll(),
      this.getOrCreateKioskState(),
      this.cashCloseoutRepository.find({
        order: {
          closedAt: 'DESC',
          id: 'DESC',
        },
        take: 1,
      }),
      this.cashCloseoutRepository.find({
        where: {
          closeoutType: 'TOTAL',
        },
        order: {
          closedAt: 'DESC',
          id: 'DESC',
        },
        take: 1,
      }),
    ]);
    const lastCloseout = lastCloseoutList[0] ?? null;
    const lastTotalCloseout = lastTotalCloseoutList[0] ?? null;

    const cycleStartedAt = lastTotalCloseout?.closedAt ?? this.resolveBusinessCycleStart();
    const [acceptedMovements, completedPayments, incidents] = await Promise.all([
      this.cashMovementRepository.find({
        where: {
          type: CashMovementType.Accepted,
          createdAt: MoreThanOrEqual(cycleStartedAt),
        },
        relations: ['denomination'],
        order: {
          createdAt: 'DESC',
          id: 'DESC',
        },
      }),
      this.paymentSessionRepository.find({
        where: {
          status: In([
            PaymentSessionStatus.Completed,
            PaymentSessionStatus.CompletedWithWarning,
          ]),
          completedAt: MoreThanOrEqual(cycleStartedAt),
        },
        order: {
          completedAt: 'DESC',
          createdAt: 'DESC',
        },
      }),
      this.cashIncidentRepository.find({
        where: {
          createdAt: MoreThanOrEqual(cycleStartedAt),
        },
        order: {
          createdAt: 'DESC',
          id: 'DESC',
        },
      }),
    ]);

    const collectionLines = this.groupMovementsByDenomination(acceptedMovements);
    const totalCollected = collectionLines.reduce((sum, item) => sum + item.subtotal, 0);
    const changeInventoryTotal = this.calculateDispenserSlotsTotal(dispenserSlots);

    return {
      cycleStartedAt: cycleStartedAt.toISOString(),
      paymentsBlocked: kioskState.paymentsBlocked,
      blockReason: kioskState.blockReason,
      kioskMode: kioskState.mode,
      changeInventoryTotal,
      transactionCount: completedPayments.length,
      totalCollected,
      collectionLines,
      incidentCount: incidents.length,
      incidentTotal: incidents.reduce((sum, incident) => sum + incident.amount, 0),
      lastCloseout: lastCloseout
        ? {
            id: lastCloseout.id,
            closedAt: lastCloseout.closedAt,
            closedBy: lastCloseout.closedBy,
            closeoutType: lastCloseout.closeoutType,
            transactionCount: lastCloseout.transactionCount,
            totalCollected: lastCloseout.totalCollected,
            notes: lastCloseout.notes,
          }
        : null,
    };
  }

  async listCashCloseouts(query: QueryCashCloseoutsDto) {
    const limit = query.limit ?? 20;
    return this.cashCloseoutRepository.find({
      relations: ['lines', 'lines.denomination'],
      order: {
        closedAt: 'DESC',
        id: 'DESC',
      },
      take: limit,
    });
  }

  async createCashCloseout(dto: CreateCashCloseoutDto) {
    const run = this.closeoutQueue.then(() => this.createCashCloseoutSerialized(dto));
    // Encadenar sin propagar el rechazo hacia la cola (si este cierre falla, el
    // siguiente debe poder ejecutarse igual) — el error real se propaga via `run`.
    this.closeoutQueue = run.catch(() => undefined);
    return run;
  }

  private async createCashCloseoutSerialized(dto: CreateCashCloseoutDto) {
    const state = await this.getOrCreateKioskState();
    if (state.paymentsBlocked) {
      throw new NotFoundException(
        state.blockReason ?? 'Ya existe una operacion que mantiene bloqueados los cobros',
      );
    }

    await this.setKioskPaymentsBlocked(
      true,
      dto.closedBy,
      dto.closeoutType === 'PARTIAL' ? 'Cierre parcial en ejecucion' : 'Cierre total en ejecucion',
    );

    try {
      return await this.dataSource.transaction(async (manager) => {
        const [lastTotalCloseout] = await manager.find(CashCloseoutEntity, {
          where: {
            closeoutType: 'TOTAL',
          },
          order: {
            closedAt: 'DESC',
            id: 'DESC',
          },
          take: 1,
        });

        const cycleStartedAt = lastTotalCloseout?.closedAt ?? this.resolveBusinessCycleStart();
        const periodEndedAt = new Date();

        const acceptedMovements = await manager.find(CashMovementEntity, {
          where: {
            type: CashMovementType.Accepted,
            createdAt: MoreThanOrEqual(cycleStartedAt),
          },
          relations: ['denomination'],
          order: {
            createdAt: 'DESC',
            id: 'DESC',
          },
        });
        const dispensedMovements = await manager.find(CashMovementEntity, {
          where: {
            type: CashMovementType.Dispensed,
            createdAt: MoreThanOrEqual(cycleStartedAt),
          },
          relations: ['denomination'],
          order: {
            createdAt: 'DESC',
            id: 'DESC',
          },
        });
        // Solo recargas de tolva (slotKey no nulo) — las recargas de la caja
        // recolectora (cash_inventory) tambien quedan como LOAD pero con slotKey null,
        // y no forman parte de la ecuacion de cuadre de tolvas.
        const hopperLoadMovements = await manager.find(CashMovementEntity, {
          where: {
            type: CashMovementType.Load,
            slotKey: Not(IsNull()),
            createdAt: MoreThanOrEqual(cycleStartedAt),
          },
          relations: ['denomination'],
          order: {
            createdAt: 'DESC',
            id: 'DESC',
          },
        });

        const completedPayments = await manager.find(PaymentSessionEntity, {
          where: {
            status: In([
              PaymentSessionStatus.Completed,
              PaymentSessionStatus.CompletedWithWarning,
            ]),
            completedAt: MoreThanOrEqual(cycleStartedAt),
          },
          order: {
            completedAt: 'DESC',
            createdAt: 'DESC',
          },
        });
        // Canceladas manualmente o vencidas por tiempo: ambas guardan completedAt al cerrarse.
        const canceledPayments = await manager.find(PaymentSessionEntity, {
          where: {
            status: In([PaymentSessionStatus.Canceled, PaymentSessionStatus.Timeout]),
            completedAt: MoreThanOrEqual(cycleStartedAt),
          },
        });
        const dispenserSlots = await manager.find(DispenserSlotEntity, {
          order: {
            slotKey: 'ASC',
          },
        });
        const incidents = await manager.find(CashIncidentEntity, {
          where: {
            createdAt: MoreThanOrEqual(cycleStartedAt),
          },
          order: {
            createdAt: 'DESC',
            id: 'DESC',
          },
        });

        const groupedLines = this.groupMovementsByDenomination(acceptedMovements);
        const totalCollected = groupedLines.reduce((sum, item) => sum + item.subtotal, 0);
        const currentHopperTotal = this.calculateDispenserSlotsTotal(dispenserSlots);
        const hopperInitialTotal = lastTotalCloseout?.hopperTotal ?? 0;

        const closeout = await manager.save(
          CashCloseoutEntity,
          manager.create(CashCloseoutEntity, {
            periodStartedAt: cycleStartedAt,
            periodEndedAt,
            closedAt: periodEndedAt,
            closedBy: dto.closedBy,
            closeoutType: dto.closeoutType,
            transactionCount: completedPayments.length,
            totalCollected,
            hopperTotal: currentHopperTotal,
            notes: dto.notes ?? null,
            receiptJson: null,
          }),
        );

        const savedLines: CashCloseoutLineEntity[] = [];
        for (const item of groupedLines) {
          const line = await manager.save(
            CashCloseoutLineEntity,
            manager.create(CashCloseoutLineEntity, {
              closeoutId: closeout.id,
              denominationId: item.denominationId,
              quantity: item.quantity,
              subtotal: item.subtotal,
            }),
          );
          savedLines.push(line);
        }

        // El cierre TOTAL implica que el operador recoge fisicamente el efectivo
        // aceptado (billetes/monedas de clientes) de la caja recolectora del validador,
        // por lo que el inventario de efectivo aceptado debe quedar en 0.
        // El cierre PARCIAL es solo un arqueo informativo: no se recoge dinero, por lo
        // que el inventario no debe resetearse en ese caso.
        // En ningun caso se afectan las tolvas de dispensado de cambio
        // (DispenserSlotEntity), que es efectivo cargado aparte por el operador para
        // dar cambio, no dinero recolectado.
        if (dto.closeoutType === 'TOTAL') {
          await manager
            .createQueryBuilder()
            .update(CashInventoryEntity)
            .set({ quantity: 0 })
            .execute();
        }

        const receiptPayload = this.buildCloseoutReceiptPayload({
          closeoutId: closeout.id,
          closeoutType: dto.closeoutType,
          periodStartedAt: cycleStartedAt,
          periodEndedAt,
          closedBy: dto.closedBy,
          notes: dto.notes ?? null,
          completedPayments,
          canceledPayments,
          acceptedMovements,
          dispensedMovements,
          hopperLoadMovements,
          hopperInitialTotal,
          dispenserSlots,
          incidents,
        });

        await manager.update(CashCloseoutEntity, { id: closeout.id }, {
          receiptJson: JSON.stringify(receiptPayload),
        });

        return manager.findOneOrFail(CashCloseoutEntity, {
          where: {
            id: closeout.id,
          },
          relations: ['lines', 'lines.denomination'],
        });
      });
    } finally {
      await this.setKioskPaymentsBlocked(false, dto.closedBy, null);
    }
  }

  async recordAcceptedCash(dto: RecordCashEventDto) {
    return this.applyInventoryMovement(dto, CashMovementType.Accepted, 1);
  }

  async recordAcceptedCashWithManager(dto: RecordCashEventDto, manager: EntityManager) {
    return this.applyInventoryMovementWithManager(dto, CashMovementType.Accepted, 1, manager);
  }

  async recordDispensedCash(dto: RecordCashEventDto) {
    return this.applyInventoryMovement(dto, CashMovementType.Dispensed, -1);
  }

  /**
   * Registra una novedad de caja (billete de $50.000/$100.000 no aceptado, o
   * remanente de vuelto no representable con las denominaciones cargadas). No
   * afecta cash_inventory ni cash_movements — es puramente informativo/auditable
   * y se reporta aparte en el tiquete de cierre.
   */
  async recordCashIncident(
    input: {
      type: CashIncidentType;
      amount: number;
      denominationId?: number | null;
      paymentSessionId?: string | null;
      note?: string | null;
      createdBy: string;
    },
    manager?: EntityManager,
  ): Promise<CashIncidentEntity> {
    const repository = manager
      ? manager.getRepository(CashIncidentEntity)
      : this.cashIncidentRepository;

    return repository.save(
      repository.create({
        type: input.type,
        amount: input.amount,
        denominationId: input.denominationId ?? null,
        paymentSessionId: input.paymentSessionId ?? null,
        note: input.note ?? null,
        createdBy: input.createdBy,
      }),
    );
  }

  async listCashIncidents(query: { from?: Date; to?: Date; limit?: number }) {
    const qb = this.cashIncidentRepository
      .createQueryBuilder('incident')
      .leftJoinAndSelect('incident.denomination', 'denomination')
      .orderBy('incident.createdAt', 'DESC')
      .addOrderBy('incident.id', 'DESC')
      .take(query.limit ?? 200);

    if (query.from) {
      qb.andWhere('incident.created_at >= :from', { from: query.from });
    }
    if (query.to) {
      qb.andWhere('incident.created_at <= :to', { to: query.to });
    }

    return qb.getMany();
  }

  /**
   * Denominacion minima que la maquina puede fisicamente dispensar hoy, segun
   * las tolvas activas configuradas por el operador (dinamico: el PPE puede
   * cambiar que denominaciones carga en cada slot).
   */
  async getSmallestDispensableDenomination(): Promise<number> {
    const slotConfig = await this.dispenserSlotService.getSlotConfig();
    const denominations = [slotConfig.bill1, slotConfig.bill2, slotConfig.coin1, slotConfig.coin2].filter(
      (value): value is number => value !== null && value > 0,
    );
    return denominations.length > 0 ? Math.min(...denominations) : Infinity;
  }

  /**
   * Carga fisica de un slot: incrementa la cantidad y registra el movimiento de
   * auditoria como una sola operacion atomica. El incremento es a nivel de DB
   * (no read-modify-write), asi que dos cargas concurrentes al mismo slot no se
   * pisan entre si.
   */
  async loadDispenserSlot(
    slotKey: string,
    input: { denominationId?: number; quantity: number; reason?: string; createdBy?: string },
  ): Promise<DispenserSlotEntity> {
    const slot = await this.assertLoadableSlot(slotKey, input.denominationId, {
      requireActive: true,
    });

    await this.dataSource.transaction(async (manager) => {
      await this.dispenserSlotService.incrementSlotQuantity(
        slot.slotKey,
        input.quantity,
        manager,
      );
      await this.recordMovementOnly(
        {
          denominationId: slot.denominationId!,
          quantity: input.quantity,
          reason: input.reason,
          createdBy: input.createdBy ?? 'admin',
        },
        CashMovementType.Load,
        input.reason ?? `Cargue manual de slot ${slotKey}`,
        manager,
        slot.slotKey,
      );
    });

    return this.dispenserSlotService.findOne(slotKey) as Promise<DispenserSlotEntity>;
  }

  /**
   * Descargue fisico de un slot: decremento atomico y con guarda (nunca queda
   * negativo, ni bajo carrera) + movimiento de auditoria, atomicos entre si.
   */
  async unloadDispenserSlot(
    slotKey: string,
    input: { denominationId?: number; quantity: number; reason?: string; createdBy?: string },
  ): Promise<DispenserSlotEntity> {
    const slot = await this.assertLoadableSlot(slotKey, input.denominationId);
    if (slot.quantity < input.quantity) {
      throw new BadRequestException(
        `Cantidad insuficiente en slot '${slotKey}': tiene ${slot.quantity}, se intenta retirar ${input.quantity}`,
      );
    }

    await this.dataSource.transaction(async (manager) => {
      await this.dispenserSlotService.decrementSlotQuantity(
        slot.slotKey,
        input.quantity,
        manager,
      );
      await this.recordMovementOnly(
        {
          denominationId: slot.denominationId!,
          quantity: input.quantity,
          reason: input.reason,
          createdBy: input.createdBy ?? 'admin',
        },
        CashMovementType.Unload,
        input.reason ?? `Descargue manual de slot ${slotKey}`,
        manager,
        slot.slotKey,
      );
    });

    return this.dispenserSlotService.findOne(slotKey) as Promise<DispenserSlotEntity>;
  }

  /**
   * Expulsion manual: el comando fisico a la placa no puede deshacerse, asi que
   * queda fuera de la transaccion; pero el descuento de la tolva y el movimiento
   * de auditoria si quedan atomicos entre si.
   */
  async ejectFromDispenserSlot(
    slotKey: string,
    quantity: number,
  ): Promise<{ slotKey: string; denominationId: number; quantity: number; totalDispensed: number }> {
    const slot = await this.dispenserSlotService.findOne(slotKey);
    if (!slot) {
      throw new NotFoundException(`Slot '${slotKey}' no encontrado`);
    }
    if (!slot.isActive || !slot.denominationId) {
      throw new BadRequestException(
        `El slot '${slotKey}' no esta activo o no tiene denominacion asignada`,
      );
    }
    if (slot.quantity < quantity) {
      throw new BadRequestException(
        `${slot.label || slotKey} no tiene suficientes unidades para expulsar ${quantity}. Actualmente dispone de ${slot.quantity}.`,
      );
    }

    const denominationId = slot.denominationId;
    const totalDispensed = denominationId * quantity;

    // Trama completa con las denominaciones reales de los 4 slots, una por unidad,
    // con total = denominacion del slot (ver PeripheralsService.ejectUnits).
    const ejection = await this.peripheralsService.ejectUnits(
      slot.slotKey,
      denominationId,
      quantity,
    );

    if (!ejection.confirmed) {
      throw new BadRequestException(
        `La placa no confirmo la expulsion desde ${slotKey}: ` +
        `${ejection.confirmedUnits} de ${quantity} unidad(es) confirmadas`,
      );
    }

    // ejectUnits ya descuenta dispenser_slots por cada unidad expulsada —
    // aqui solo falta dejar el registro de auditoria del movimiento.
    await this.recordMovementOnly(
      {
        denominationId,
        quantity,
        reason: `Expulsion manual desde ${slotKey}`,
        createdBy: 'admin',
      },
      CashMovementType.Unload,
      `Expulsion manual de ${quantity} unidad(es) desde ${slotKey}`,
      undefined,
      slot.slotKey,
    );

    return { slotKey, denominationId, quantity, totalDispensed };
  }

  private async assertLoadableSlot(
    slotKey: string,
    requestedDenominationId?: number,
    options?: { requireActive?: boolean },
  ): Promise<DispenserSlotEntity & { slotKey: DispenserSlotKey }> {
    const slot = await this.dispenserSlotService.findOne(slotKey);
    if (!slot) {
      throw new NotFoundException(`Slot '${slotKey}' no encontrado`);
    }
    if (!slot.denominationId) {
      throw new BadRequestException(`Slot '${slotKey}' no tiene denominacion asignada`);
    }
    if (options?.requireActive && !slot.isActive) {
      throw new BadRequestException(`Slot '${slotKey}' esta inactivo`);
    }
    if (requestedDenominationId !== undefined && requestedDenominationId !== slot.denominationId) {
      throw new BadRequestException(
        `La denominacion enviada (${requestedDenominationId}) no coincide con la del slot '${slotKey}' (${slot.denominationId})`,
      );
    }
    return slot as DispenserSlotEntity & { slotKey: DispenserSlotKey };
  }

  async getAcceptancePolicy(targetAmount: number, insertedAmount: number) {
    const pendingAmount = Math.max(0, targetAmount - insertedAmount);
    const slotConfig = await this.dispenserSlotService.getSlotConfig();
    const dispensableDenominations = new Set(
      [slotConfig.bill1, slotConfig.bill2, slotConfig.coin1, slotConfig.coin2].filter(
        (value): value is number => value !== null && value > 0,
      ),
    );

    const acceptedBillDenominations: number[] = [];

    for (const denomination of CashInventoryService.BILL_DENOMINATIONS) {
      if (denomination <= pendingAmount) {
        acceptedBillDenominations.push(denomination);
        continue;
      }

      const requiredChange = denomination - pendingAmount;
      const plan = await this.cashChangeService.planChange(
        requiredChange,
        dispensableDenominations,
      );

      if (plan.remaining === 0) {
        acceptedBillDenominations.push(denomination);
      }
    }

    const maxAcceptedBill =
      acceptedBillDenominations.length > 0
        ? acceptedBillDenominations[acceptedBillDenominations.length - 1]
        : 0;
    const firstRejectedBill =
      CashInventoryService.BILL_DENOMINATIONS.find(
        (denomination) => !acceptedBillDenominations.includes(denomination),
      ) ?? 0;

    return {
      pendingAmount,
      acceptedBillDenominations,
      maxAcceptedBill,
      message:
        maxAcceptedBill > 0
          ? `Solo se admiten denominaciones hasta $${maxAcceptedBill.toLocaleString('es-CO')}. A partir de $${(firstRejectedBill || maxAcceptedBill).toLocaleString('es-CO')} la maquina podria no tener cambio suficiente.`
          : firstRejectedBill > 0
            ? `Por favor ingrese dinero exacto. La maquina no cuenta con cambio suficiente a partir de $${firstRejectedBill.toLocaleString('es-CO')}.`
            : 'Por favor ingrese dinero exacto. La maquina no cuenta con cambio suficiente en este momento.',
      dispensableDenominations: [...dispensableDenominations].sort((left, right) => right - left),
    };
  }

  private async applyManualAdjustment(
    dto: CashAdjustmentDto,
    movementType: CashMovementType.Load | CashMovementType.Unload,
  ) {
    const quantityMultiplier = movementType === CashMovementType.Load ? 1 : -1;
    return this.applyInventoryMovement(
      {
        denominationId: dto.denominationId,
        quantity: dto.quantity,
        createdBy: dto.createdBy ?? 'manual',
      },
      movementType,
      quantityMultiplier,
      dto.reason,
    );
  }

  private async applyInventoryMovementWithManager(
    dto: RecordCashEventDto,
    movementType: CashMovementType,
    inventoryDirection: 1 | -1,
    manager: EntityManager,
    reasonOverride?: string,
  ) {
    const denomination = await manager.findOne(DenominationEntity, {
      where: { id: dto.denominationId, isActive: true },
    });

    if (!denomination) {
      throw new NotFoundException(`No existe la denominacion ${dto.denominationId}`);
    }

    const inventory = await manager.findOne(CashInventoryEntity, {
      where: { denominationId: dto.denominationId },
    });

    if (!inventory) {
      throw new NotFoundException(`No existe inventario para la denominacion ${dto.denominationId}`);
    }

    const newQuantity = inventory.quantity + dto.quantity * inventoryDirection;
    if (newQuantity < 0) {
      throw new NotFoundException(`Inventario insuficiente para la denominacion ${dto.denominationId}`);
    }

    inventory.quantity = newQuantity;
    await manager.save(CashInventoryEntity, inventory);

    const movement = manager.create(CashMovementEntity, {
      type: movementType,
      denominationId: dto.denominationId,
      quantity: dto.quantity,
      unitValue: denomination.id,
      totalValue: denomination.id * dto.quantity,
      reason:
        reasonOverride ??
        `Movimiento ${movementType.toLowerCase()} de denominacion ${dto.denominationId}`,
      paymentSessionId: dto.paymentSessionId ?? null,
      createdBy: dto.createdBy ?? 'system',
    });

    await manager.save(CashMovementEntity, movement);

    return {
      denominationId: dto.denominationId,
      movementType,
      quantity: dto.quantity,
      resultingQuantity: inventory.quantity,
    };
  }

  private async applyInventoryMovement(
    dto: RecordCashEventDto,
    movementType: CashMovementType,
    inventoryDirection: 1 | -1,
    reasonOverride?: string,
  ) {
    return this.dataSource.transaction((manager) =>
      this.applyInventoryMovementWithManager(dto, movementType, inventoryDirection, manager, reasonOverride),
    );
  }

  private resolveBusinessCycleStart(): Date {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    return start;
  }

  private groupMovementsByDenomination(
    movements: CashMovementEntity[],
  ): Array<{
    denominationId: number;
    kind: string;
    quantity: number;
    subtotal: number;
  }> {
    const grouped = new Map<number, { denominationId: number; kind: string; quantity: number; subtotal: number }>();

    for (const movement of movements) {
      const current = grouped.get(movement.denominationId) ?? {
        denominationId: movement.denominationId,
        kind: movement.denomination.kind,
        quantity: 0,
        subtotal: 0,
      };
      current.quantity += movement.quantity;
      current.subtotal += movement.totalValue;
      grouped.set(movement.denominationId, current);
    }

    return [...grouped.values()].sort((left, right) => right.denominationId - left.denominationId);
  }

  private buildCloseoutReceiptPayload(args: {
    closeoutId: number;
    closeoutType: 'PARTIAL' | 'TOTAL';
    periodStartedAt: Date;
    periodEndedAt: Date;
    closedBy: string;
    notes: string | null;
    completedPayments: PaymentSessionEntity[];
    canceledPayments: PaymentSessionEntity[];
    acceptedMovements: CashMovementEntity[];
    dispensedMovements: CashMovementEntity[];
    hopperLoadMovements: CashMovementEntity[];
    hopperInitialTotal: number;
    dispenserSlots: DispenserSlotEntity[];
    incidents: CashIncidentEntity[];
  }) {
    const transactionRows = this.groupPaymentsByProfileAndVehicle(args.completedPayments);
    // Ticket corto: Visitante Carro/Moto siempre presentes (en 0 si no hubo pagos),
    // seguidos de cualquier otro perfil que si haya tenido pagos.
    const shortTransactionRows: CloseoutReceiptRow[] = [
      ...VISITOR_TRANSACTION_ITEMS.map(
        (item) =>
          transactionRows.find((row) => row.item === item) ?? { item, quantity: 0, total: 0 },
      ),
      ...transactionRows.filter((row) => !VISITOR_TRANSACTION_ITEMS.includes(row.item)),
    ];
    const acceptedRows = this.groupMovementsByDenomination(args.acceptedMovements).map((row) => ({
      item: `${row.kind === 'BILL' ? 'Billete' : 'Moneda'} $${row.denominationId.toLocaleString('es-CO')}`,
      quantity: row.quantity,
      total: row.subtotal,
    }));
    const dispensedBySlotRows = this.groupDispensedCommandsBySlot(args.completedPayments).map((row) => ({
      item: `${row.slotLabel} $${row.denomination.toLocaleString('es-CO')}`,
      quantity: row.quantity,
      total: row.total,
    }));
    const hopperLoadRows = this.groupMovementsByDenomination(args.hopperLoadMovements).map((row) => ({
      item: `${row.kind === 'BILL' ? 'Billete' : 'Moneda'} $${row.denominationId.toLocaleString('es-CO')}`,
      quantity: row.quantity,
      total: row.subtotal,
    }));
    const hopperRows = args.dispenserSlots
      .filter((slot) => slot.denominationId && slot.quantity > 0)
      .map((slot) => ({
        item: `${slot.label || this.slotLabel(slot.slotKey)} $${slot.denominationId!.toLocaleString('es-CO')}`,
        quantity: slot.quantity,
        total: slot.quantity * slot.denominationId!,
      }));
    const incidentRows: CloseoutReceiptRow[] = args.incidents.map((incident) => ({
      item:
        incident.type === CashIncidentType.RejectedLargeBill
          ? 'Billete no aceptado'
          : 'Vuelto no entregado',
      total: incident.amount,
    }));
    const transactionTotal = transactionRows.reduce((sum, row) => sum + Number(row.total ?? 0), 0);
    const acceptedTotal = acceptedRows.reduce((sum, row) => sum + Number(row.total ?? 0), 0);
    const dispensedTotal = dispensedBySlotRows.reduce((sum, row) => sum + Number(row.total ?? 0), 0);
    const hopperLoadTotal = hopperLoadRows.reduce((sum, row) => sum + Number(row.total ?? 0), 0);
    const hopperTotal = this.calculateDispenserSlotsTotal(args.dispenserSlots);
    const incidentTotal = incidentRows.reduce((sum, row) => sum + Number(row.total ?? 0), 0);
    // Recaudo neto de transacciones: lo que realmente queda tras devolver cambio.
    const netCollectionTotal = acceptedTotal - dispensedTotal;
    // Cuadre de tolvas: inicial (cierre TOTAL anterior) + recargas del periodo - lo
    // entregado como cambio debe coincidir con el saldo fisico actual de las tolvas.
    // Si "difference" no es 0, hay una discrepancia (ej. la placa no confirmo una
    // devolucion pero el software si descuento el cambio, o viceversa).
    const expectedHopperTotal = args.hopperInitialTotal + hopperLoadTotal - dispensedTotal;
    const hopperDifference = hopperTotal - expectedHopperTotal;
    const summaryRows: CloseoutReceiptRow[] = [
      { item: 'Cantidad pagos', quantity: args.completedPayments.length },
      { item: 'Total pagos', total: transactionTotal },
      { item: 'Dinero ingresado', total: acceptedTotal },
      { item: 'Dinero devuelto', total: dispensedTotal },
      { item: 'Recaudo neto', total: netCollectionTotal },
    ];
    // Valor de las sesiones canceladas: lo que se iba a cobrar (no es dinero recibido).
    const canceledTotal = args.canceledPayments.reduce(
      (sum, payment) => sum + payment.targetAmount,
      0,
    );
    // TOTAL de transacciones definido por el negocio: exitosas - canceladas.
    const transactionsNetTotal = transactionTotal - canceledTotal;
    const transactionStatusRows: CloseoutReceiptRow[] = [
      {
        item: 'Trans. exitosas',
        quantity: args.completedPayments.length,
        total: transactionTotal,
      },
      {
        item: 'Trans. canceladas',
        quantity: args.canceledPayments.length,
        total: canceledTotal,
      },
    ];
    const reconciliationRows: CloseoutReceiptRow[] = [
      { item: 'Tolvas inicial', total: args.hopperInitialTotal },
      { item: 'Recargas tolvas', total: hopperLoadTotal },
      { item: 'Devoluciones', total: dispensedTotal },
      { item: 'Tolvas esperado', total: expectedHopperTotal },
      { item: 'Tolvas real', total: hopperTotal },
      { item: 'Diferencia', total: hopperDifference },
    ];

    const sections: CloseoutReceiptSection[] = [
      {
        title: 'Resumen',
        rows: summaryRows,
      },
      {
        title: 'Transacciones',
        rows: transactionRows,
        summaryRows: transactionStatusRows,
        total: transactionsNetTotal,
      },
      {
        title: 'Dinero recibido',
        rows: acceptedRows.length > 0 ? acceptedRows : [{ item: 'Sin recaudo', quantity: 0, total: 0 }],
        total: acceptedTotal,
      },
      {
        title: 'Dinero devolucion',
        rows: dispensedBySlotRows.length > 0 ? dispensedBySlotRows : [{ item: 'Sin devoluciones', quantity: 0, total: 0 }],
        total: dispensedTotal,
      },
      {
        title: 'Recargas a tolvas',
        rows: hopperLoadRows.length > 0 ? hopperLoadRows : [{ item: 'Sin recargas', quantity: 0, total: 0 }],
        total: hopperLoadTotal,
      },
      {
        title: 'Dinero en tolvas',
        rows: hopperRows.length > 0 ? hopperRows : [{ item: 'Tolvas vacias', quantity: 0, total: 0 }],
        total: hopperTotal,
      },
      {
        title: 'Cuadre de tolvas',
        rows: reconciliationRows,
      },
      {
        title: 'Novedades',
        rows: incidentRows.length > 0 ? incidentRows : [{ item: 'Sin novedades', quantity: 0, total: 0 }],
        total: incidentTotal,
      },
    ];

    return {
      title: 'coins',
      subtitle: `Cierre de caja ${args.closeoutType === 'PARTIAL' ? 'parcial' : 'total'}`,
      closeoutId: args.closeoutId,
      closeoutType: args.closeoutType,
      responsible: args.closedBy,
      periodStartedAt: args.periodStartedAt.toISOString(),
      periodEndedAt: args.periodEndedAt.toISOString(),
      transactionCount: args.completedPayments.length,
      // Ticket corto que se imprime antes del cierre completo
      transactionsTicket: {
        title: 'Transacciones',
        rows: shortTransactionRows,
        summaryRows: transactionStatusRows,
        total: transactionsNetTotal,
      } satisfies CloseoutReceiptSection,
      sections,
      footerLines: args.notes ? [`Notas: ${args.notes}`] : [],
    };
  }

  private groupPaymentsByProfileAndVehicle(
    payments: PaymentSessionEntity[],
  ): Array<{ item: string; quantity: number; total: number }> {
    const grouped = new Map<string, { item: string; quantity: number; total: number }>();

    for (const payment of payments) {
      const metadata = this.parseJsonRecord(payment.metadataJson);
      const validation =
        metadata && typeof metadata.validation === 'object' && metadata.validation !== null
          ? (metadata.validation as Record<string, unknown>)
          : null;
      const profile =
        this.normalizeProfileLabel(
          typeof validation?.incomeConditionType === 'string'
            ? validation.incomeConditionType
            : payment.concept,
        ) ?? 'No clasificado';
      const vehicle =
        this.normalizeVehicleLabel(
          typeof validation?.vehicleType === 'string'
            ? validation.vehicleType
            : payment.vehicleType,
        ) ?? 'Sin vehiculo';
      const item = `${profile} ${vehicle}`.trim();
      const key = `${profile}::${vehicle}`;
      const current = grouped.get(key) ?? { item, quantity: 0, total: 0 };
      current.quantity += 1;
      current.total += payment.targetAmount;
      grouped.set(key, current);
    }

    return [...grouped.values()].sort((left, right) => left.item.localeCompare(right.item, 'es-CO'));
  }

  private groupDispensedCommandsBySlot(
    payments: PaymentSessionEntity[],
  ): Array<{ slotLabel: string; denomination: number; quantity: number; total: number }> {
    const grouped = new Map<string, { slotLabel: string; denomination: number; quantity: number; total: number }>();

    for (const payment of payments) {
      const commandsRaw = this.parseJsonArray(payment.changeCommandsJson);
      for (const command of commandsRaw) {
        if (!command || typeof command !== 'object') {
          continue;
        }

        const slotKey = typeof command.slotKey === 'string' ? command.slotKey : null;
        // Compatibilidad con historico: returnChange() (pre-devolucion confiable) guardaba
        // "requestedDenomination"; la devolucion por tramas fijas (ya retirada) guardaba "denomination".
        const denomination =
          typeof command.denomination === 'number'
            ? command.denomination
            : typeof command.requestedDenomination === 'number'
              ? command.requestedDenomination
              : null;
        const quantity = typeof command.quantity === 'number' ? command.quantity : null;

        if (!slotKey || !denomination || !quantity) {
          continue;
        }

        const slotLabel = this.slotLabel(slotKey);
        const key = `${slotKey}::${denomination}`;
        const current = grouped.get(key) ?? {
          slotLabel,
          denomination,
          quantity: 0,
          total: 0,
        };
        current.quantity += quantity;
        current.total += quantity * denomination;
        grouped.set(key, current);
      }
    }

    return [...grouped.values()].sort((left, right) => left.slotLabel.localeCompare(right.slotLabel, 'es-CO'));
  }

  private parseJsonRecord(raw: string | null): Record<string, unknown> | null {
    if (!raw) {
      return null;
    }

    try {
      const parsed = JSON.parse(raw) as unknown;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return null;
      }
      return parsed as Record<string, unknown>;
    } catch {
      return null;
    }
  }

  private parseJsonArray(raw: string | null): Array<Record<string, unknown>> {
    if (!raw) {
      return [];
    }

    try {
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) {
        return [];
      }
      return parsed.filter((item): item is Record<string, unknown> => !!item && typeof item === 'object');
    } catch {
      return [];
    }
  }

  private normalizeLabel(value: string | null | undefined): string | null {
    if (!value) {
      return null;
    }

    return value.replace(/\s+/g, ' ').trim();
  }

  private normalizeComparisonLabel(value: string | null | undefined): string {
    return (value ?? '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .toUpperCase();
  }

  private normalizeProfileLabel(value: string | null | undefined): string | null {
    const normalized = this.normalizeLabel(value);
    if (!normalized) {
      return null;
    }

    const comparison = this.normalizeComparisonLabel(normalized)
      .replace(/[()]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    // nexo_back envia el incomeConditionType del servicio: "Visitor", "VisitorDescuento",
    // "Privado", "Mensualidad", "MensualidadInterna"...
    if (comparison.includes('VISITANTE') || comparison.includes('VISITOR')) {
      return 'Visitante';
    }
    if (comparison.includes('PRIVADO')) {
      return 'Privado';
    }
    if (comparison.includes('MENSUALIDAD')) {
      return 'Mensualidad';
    }
    if (comparison.includes('DOCENTE')) {
      return 'Docente';
    }
    if (comparison.includes('ESTUDIANTE')) {
      return 'Estudiante';
    }
    if (comparison.includes('TERCERO')) {
      return 'Tercero';
    }
    if (comparison.includes('ADMINISTRATIVO')) {
      return 'Administrativo';
    }
    if (comparison.includes('EGRESADO')) {
      return 'Egresado';
    }
    if (comparison.includes('TICKET') && comparison.includes('PERDIDO')) {
      return 'Ticket perdido';
    }

    return normalized;
  }

  private normalizeVehicleLabel(value: string | null | undefined): string | null {
    const normalized = this.normalizeLabel(value);
    if (!normalized) {
      return null;
    }

    const upper = this.normalizeComparisonLabel(normalized);
    if (upper.includes('MOTO')) {
      return 'Moto';
    }
    if (upper.includes('CAR')) {
      return 'Carro';
    }
    return normalized;
  }

  /**
   * Unica fuente de verdad para el total de dinero en tolvas — usada tanto por
   * el dashboard en vivo (getDailyDashboard) como por el recibo de cierre
   * (buildCloseoutReceiptPayload), para que ambos muestren siempre el mismo
   * numero en vez de dos calculos independientes que puedan divergir si se
   * modifica uno y no el otro.
   */
  private calculateDispenserSlotsTotal(slots: DispenserSlotEntity[]): number {
    return slots.reduce((sum, slot) => sum + slot.quantity * (slot.denominationId ?? 0), 0);
  }

  /**
   * Fallback cuando no hay entidad DispenserSlotEntity disponible (p.ej. comandos
   * historicos de devolucion guardados en changeCommandsJson, que solo tienen el
   * slotKey). El nombre real y editable vive en dispenser_slots.label (semilla).
   */
  private slotLabel(slotKey: string): string {
    switch (slotKey) {
      case 'bill1':
        return 'Bill 1';
      case 'bill2':
        return 'Bill 2';
      case 'coin1':
        return 'Mon 1';
      case 'coin2':
        return 'Mon 2';
      default:
        return slotKey;
    }
  }

  private async getOrCreateKioskState(): Promise<KioskStateEntity> {
    const existing = await this.kioskStateRepository.findOne({
      where: { id: CashInventoryService.KIOSK_STATE_SINGLETON_ID },
    });

    if (existing) {
      return existing;
    }

    return this.kioskStateRepository.save(
      this.kioskStateRepository.create({
        id: CashInventoryService.KIOSK_STATE_SINGLETON_ID,
        mode: KioskMode.Payment,
        paymentsBlocked: false,
        blockReason: null,
        updatedBy: 'cash-management-bootstrap',
      }),
    );
  }

  private async setKioskPaymentsBlocked(
    paymentsBlocked: boolean,
    updatedBy: string,
    blockReason: string | null,
  ) {
    const state = await this.getOrCreateKioskState();
    state.paymentsBlocked = paymentsBlocked;
    state.blockReason = paymentsBlocked ? blockReason : null;
    state.updatedBy = updatedBy;
    await this.kioskStateRepository.save(state);
  }
}
