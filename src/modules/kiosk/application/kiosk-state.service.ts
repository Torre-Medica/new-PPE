import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { KioskEventsService } from '@modules/kiosk/application/kiosk-events.service';
import {
  KioskMode,
  KioskStateEntity,
} from '@modules/persistence/infrastructure/entities/kiosk-state.entity';

@Injectable()
export class KioskStateService {
  private static readonly SINGLETON_ID = 1;

  constructor(
    @InjectRepository(KioskStateEntity)
    private readonly kioskStateRepository: Repository<KioskStateEntity>,
    private readonly kioskEventsService: KioskEventsService,
  ) {}

  async getState(): Promise<KioskStateEntity> {
    const existing = await this.kioskStateRepository.findOne({
      where: { id: KioskStateService.SINGLETON_ID },
    });

    if (existing) {
      return existing;
    }

    const created = this.kioskStateRepository.create({
      id: KioskStateService.SINGLETON_ID,
      mode: KioskMode.Payment,
      paymentsBlocked: false,
      blockReason: null,
      updatedBy: 'system-bootstrap',
    });

    return this.kioskStateRepository.save(created);
  }

  async isPaymentModeEnabled(): Promise<boolean> {
    const state = await this.getState();
    return state.mode === KioskMode.Payment && !state.paymentsBlocked;
  }

  async assertPaymentAvailability(): Promise<{
    allowed: boolean;
    reason: string | null;
    state: KioskStateEntity;
  }> {
    const state = await this.getState();

    if (state.mode !== KioskMode.Payment) {
      return {
        allowed: false,
        reason: 'El PPE no esta en modo cobro',
        state,
      };
    }

    if (state.paymentsBlocked) {
      return {
        allowed: false,
        reason: state.blockReason ?? 'Los cobros estan bloqueados temporalmente',
        state,
      };
    }

    return {
      allowed: true,
      reason: null,
      state,
    };
  }

  async setMode(mode: KioskMode, changedBy = 'local-kiosk'): Promise<KioskStateEntity> {
    const state = await this.getState();
    state.mode = mode;
    state.updatedBy = changedBy;

    const saved = await this.kioskStateRepository.save(state);
    this.kioskEventsService.emit('kiosk.mode.changed', {
      mode: saved.mode,
      updatedBy: saved.updatedBy,
      paymentsBlocked: saved.paymentsBlocked,
      blockReason: saved.blockReason,
    });

    return saved;
  }

  async setPaymentsBlocked(
    paymentsBlocked: boolean,
    changedBy = 'local-kiosk',
    blockReason: string | null = null,
  ): Promise<KioskStateEntity> {
    const state = await this.getState();
    state.paymentsBlocked = paymentsBlocked;
    state.blockReason = paymentsBlocked ? blockReason : null;
    state.updatedBy = changedBy;

    const saved = await this.kioskStateRepository.save(state);
    this.kioskEventsService.emit('kiosk.payment-lock.changed', {
      paymentsBlocked: saved.paymentsBlocked,
      blockReason: saved.blockReason,
      updatedBy: saved.updatedBy,
    });

    return saved;
  }
}
