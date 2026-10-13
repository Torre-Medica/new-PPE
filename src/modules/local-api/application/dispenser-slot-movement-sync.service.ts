import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { CashInventoryService } from '@modules/cash-management/application/cash-inventory.service';
import { NexoBackRestService } from '@modules/server-link/application/nexo-back-rest.service';

/**
 * Envia a nexo_back el historial de cargas/descargas de las tolvas, para que el
 * frontend Nexo lo muestre en Puntos de pago. Se envia despues de cada movimiento,
 * al arrancar y cada 10 min (reintento si nexo_back no estaba disponible). Es
 * idempotente: nexo_back no duplica movimientos ya recibidos.
 */
@Injectable()
export class DispenserSlotMovementSyncService implements OnApplicationBootstrap, OnModuleDestroy {
  private static readonly STARTUP_DELAY_MS = 15_000;
  private static readonly RETRY_INTERVAL_MS = 10 * 60_000;
  private static readonly BATCH_LIMIT = 1000;

  private readonly logger = new Logger(DispenserSlotMovementSyncService.name);
  private startupTimer: NodeJS.Timeout | null = null;
  private retryTimer: NodeJS.Timeout | null = null;
  private syncing = false;

  constructor(
    private readonly cashInventoryService: CashInventoryService,
    private readonly nexoBackRestService: NexoBackRestService,
  ) {}

  onApplicationBootstrap(): void {
    this.startupTimer = setTimeout(() => void this.sync(), DispenserSlotMovementSyncService.STARTUP_DELAY_MS);
    this.retryTimer = setInterval(() => void this.sync(), DispenserSlotMovementSyncService.RETRY_INTERVAL_MS);
  }

  onModuleDestroy(): void {
    if (this.startupTimer) clearTimeout(this.startupTimer);
    if (this.retryTimer) clearInterval(this.retryTimer);
  }

  async sync(): Promise<void> {
    if (this.syncing) return;
    this.syncing = true;
    try {
      const movements = await this.cashInventoryService.getDispenserSlotMovements({
        limit: DispenserSlotMovementSyncService.BATCH_LIMIT,
      });
      if (movements.length === 0) return;

      await this.nexoBackRestService.syncDispenserSlotMovements(
        movements.map((movement) => ({
          id: movement.id,
          type: movement.type,
          slotKey: movement.slotKey ?? '',
          slotLabel: movement.slotLabel ?? movement.slotKey ?? '',
          denominationId: movement.denominationId,
          quantityBefore: movement.quantityBefore,
          quantityAfter: movement.quantityAfter,
          quantityDifference: movement.quantityDifference,
          valueDifference: movement.valueDifference,
          createdBy: movement.createdBy,
          reason: movement.reason,
          createdAt: new Date(movement.createdAt).toISOString(),
        })),
      );
    } catch (error) {
      this.logger.warn(
        `No fue posible enviar el historial de cargas a nexo_back: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      this.syncing = false;
    }
  }
}
