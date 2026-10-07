import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { createHmac, randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { KioskStateService } from '@modules/kiosk/application/kiosk-state.service';
import { KioskMode } from '@modules/persistence/infrastructure/entities/kiosk-state.entity';
import { io, Socket } from 'socket.io-client';
import { CancelPaymentDto } from '@modules/server-link/application/dto/cancel-payment.dto';
import { CommitPaymentDto } from '@modules/server-link/application/dto/commit-payment.dto';
import { ValidatePaymentDto } from '@modules/server-link/application/dto/validate-payment.dto';
import { ServerLinkPort } from '@modules/server-link/domain/ports/server-link.port';
import { NexoBackRestService } from '@modules/server-link/application/nexo-back-rest.service';
import {
  GenerateMonthlySubscriptionDto,
  ValidateMonthlySubscriptionDto,
} from '@modules/server-link/application/dto/monthly-subscription.dto';

@Injectable()
export class ServerLinkService implements OnModuleInit, OnModuleDestroy, ServerLinkPort {
  private static readonly CONNECTED_BY = 'server-link-connected';
  private static readonly DISCONNECTED_BY = 'server-link-disconnected';
  private static readonly CONNECTIVITY_SYNC_INTERVAL_MS = 5_000;

  private readonly logger = new Logger(ServerLinkService.name);
  private socket: Socket | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private connectivitySyncTimer: NodeJS.Timeout | null = null;
  private hasPublishedConnectivityMode = false;

  constructor(
    private readonly configService: ConfigService,
    private readonly kioskStateService: KioskStateService,
    private readonly nexoBackRestService: NexoBackRestService,
  ) {}

  onModuleInit() {
    this.connect();
    this.startConnectivitySync();
  }

  onModuleDestroy() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.connectivitySyncTimer) {
      clearInterval(this.connectivitySyncTimer);
      this.connectivitySyncTimer = null;
    }
    this.socket?.disconnect();
  }

  async getConnectionStatus() {
    await this.reconcileKioskModeWithSocketState();

    return {
      connected: this.socket?.connected ?? false,
      url: this.configService.getOrThrow<string>('serverLink.url'),
      namespace: this.configService.get<string>('serverLink.namespace', '/'),
      deviceUuid: this.configService.get<string>('serverLink.deviceUuid', ''),
    };
  }

  async validatePaymentCandidate(dto: ValidatePaymentDto) {
    if (!this.socket?.connected) {
      return {
        source: 'local-fallback',
        status: 'SERVER_ERROR',
        accepted: false,
        payable: false,
        reason: 'server-unavailable',
        ppeTransactionUuid: dto.ppeTransactionUuid,
        qrCode: dto.qrCode ?? null,
        vehiclePlate: dto.vehiclePlate ?? null,
      };
    }

    return this.emitWithAck('ppe.payment.validate', dto);
  }

  async commitPayment(dto: CommitPaymentDto) {
    if (
      this.isElectronicBillingEnabled() &&
      dto.customerIdentificationNumber?.trim()
    ) {
      return this.nexoBackRestService.commitElectronicBillingPayment(dto);
    }

    const standardCommitPayload = this.toStandardCommitPayload(dto);

    if (!this.socket?.connected) {
      return {
        source: 'local-fallback',
        paymentRegistered: false,
        allowedToExit: false,
        serverPaymentId: null,
        ppeTransactionUuid: standardCommitPayload.ppeTransactionUuid,
      };
    }

    return this.emitWithAck('ppe.payment.commit', standardCommitPayload);
  }

  async cancelPayment(dto: CancelPaymentDto) {
    if (!this.socket?.connected) {
      return {
        source: 'local-fallback',
        canceled: false,
        acknowledged: false,
        ppeTransactionUuid: dto.ppeTransactionUuid,
      };
    }

    return this.emitWithAck('ppe.payment.cancel', dto);
  }

  getCompanyInfo() {
    return this.nexoBackRestService.getCompanyInfo();
  }

  getPaymentInvoice(serverPaymentId: number) {
    return this.nexoBackRestService.getPaymentInvoice(serverPaymentId);
  }

  prepareMonthlySubscription(identificationCode: string) {
    return this.nexoBackRestService.prepareMonthlySubscription(identificationCode);
  }

  validateMonthlySubscription(dto: ValidateMonthlySubscriptionDto) {
    return this.nexoBackRestService.validateMonthlySubscription(dto);
  }

  generateMonthlySubscriptionPayment(
    dto: GenerateMonthlySubscriptionDto,
    ppeTransactionUuid: string,
  ) {
    return this.nexoBackRestService.generateMonthlySubscriptionPayment(
      dto,
      ppeTransactionUuid,
    );
  }

  private connect() {
    const url = this.configService.getOrThrow<string>('serverLink.url');
    const namespace = this.configService.get<string>('serverLink.namespace', '/');
    const deviceUuid = this.configService.get<string>('serverLink.deviceUuid', '');
    const deviceSecret = this.configService.get<string>('serverLink.deviceSecret', '');

    this.socket = io(`${url}${namespace === '/' ? '' : namespace}`, {
      transports: ['websocket'],
      autoConnect: true,
      reconnection: true,
      reconnectionDelay: 10_000,
      reconnectionDelayMax: 10_000,
      randomizationFactor: 0,
      auth: {
        uuid: deviceUuid,
        secret: deviceSecret,
      },
    });

    this.socket.on('connect', () => {
      if (this.reconnectTimer) {
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;
      }
      this.logger.log(
        `Conectado a nexo_back — socket ${this.socket?.id ?? 'n/a'} | uuid=${deviceUuid}`,
      );
      void this.applyAutomaticKioskMode(
        KioskMode.Payment,
        ServerLinkService.CONNECTED_BY,
      );
    });

    this.socket.on('disconnect', (reason) => {
      this.logger.warn(`Desconectado de nexo_back: ${reason}`);

      if (reason !== 'io client disconnect') {
        void this.applyAutomaticKioskMode(
          KioskMode.Maintenance,
          ServerLinkService.DISCONNECTED_BY,
        );
      }

      if (reason === 'io server disconnect') {
        // El servidor cerró la conexión activamente — socket.io NO reconecta solo en este caso.
        // Programamos reconexión manual cada 10 s.
        this.scheduleManualReconnect(url);
      }
    });

    this.socket.on('connect_error', (error: Error) => {
      this.logger.warn(
        `Sin conexion con nexo_back (${url}) — reintentando en 10 s | ${error.message}`,
      );
      void this.applyAutomaticKioskMode(
        KioskMode.Maintenance,
        ServerLinkService.DISCONNECTED_BY,
      );
    });

    this.socket.io.on('reconnect_attempt', (attempt: number) => {
      this.logger.log(`Intentando reconectar con nexo_back (intento #${attempt})...`);
    });
  }

  private scheduleManualReconnect(url: string): void {
    if (this.reconnectTimer) {
      return;
    }

    this.logger.warn(
      `nexo_back cerro la conexion — reconexion manual programada en 10 s (${url})`,
    );

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.logger.log(`Intentando reconectar con nexo_back (reconexion manual)...`);
      this.socket?.connect();
    }, 10_000);
  }

  private async applyAutomaticKioskMode(mode: KioskMode, changedBy: string): Promise<void> {
    try {
      const state = await this.kioskStateService.getState();

      if (state.mode === mode && this.hasPublishedConnectivityMode) {
        return;
      }

      await this.kioskStateService.setMode(mode, changedBy);
      this.hasPublishedConnectivityMode = true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const stack = error instanceof Error ? error.stack : undefined;
      this.logger.error(
        `No fue posible sincronizar el modo del kiosko con nexo_back: ${message}`,
        stack,
      );
    }
  }

  private startConnectivitySync(): void {
    this.connectivitySyncTimer = setInterval(() => {
      void this.reconcileKioskModeWithSocketState();
    }, ServerLinkService.CONNECTIVITY_SYNC_INTERVAL_MS);
  }

  private async reconcileKioskModeWithSocketState(): Promise<void> {
    try {
      const socketConnected = this.socket?.connected ?? false;
      const state = await this.kioskStateService.getState();

      if (
        socketConnected &&
        state.mode === KioskMode.Maintenance &&
        state.updatedBy === ServerLinkService.DISCONNECTED_BY
      ) {
        this.logger.warn(
          'El socket con nexo_back esta conectado, pero el kiosko seguia en mantenimiento por desconexion previa. Reconciliando a modo cobro.',
        );
        await this.applyAutomaticKioskMode(
          KioskMode.Payment,
          ServerLinkService.CONNECTED_BY,
        );
        return;
      }

      if (
        !socketConnected &&
        state.mode === KioskMode.Payment &&
        state.updatedBy === ServerLinkService.CONNECTED_BY
      ) {
        await this.applyAutomaticKioskMode(
          KioskMode.Maintenance,
          ServerLinkService.DISCONNECTED_BY,
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `No fue posible reconciliar el estado del kiosko con el socket: ${message}`,
      );
    }
  }

  private emitWithAck(event: string, payload: object): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (!this.socket) {
        reject(new Error('Socket no inicializado'));
        return;
      }

      const signedEnvelope = this.buildSignedEnvelope(payload);

      this.socket.timeout(15000).emit(
        event,
        signedEnvelope,
        (error: Error | null, response: unknown) => {
          if (error) {
            reject(error);
            return;
          }

          resolve(response);
        },
      );
    });
  }

  private buildSignedEnvelope(payload: object) {
    const deviceUuid = this.configService.get<string>('serverLink.deviceUuid', '');
    const deviceSecret = this.configService.get<string>('serverLink.deviceSecret', '');
    const nonce = randomUUID();
    const timestamp = new Date().toISOString();
    const canonicalPayload = JSON.stringify(payload);
    const signature = createHmac('sha256', deviceSecret)
      .update(`${deviceUuid}.${timestamp}.${nonce}.${canonicalPayload}`)
      .digest('hex');

    return {
      ...payload,
      deviceUuid,
      nonce,
      timestamp,
      signature,
    };
  }

  private isElectronicBillingEnabled() {
    return this.configService.get<boolean>('features.electronicBillingEnabled', false);
  }

  private toStandardCommitPayload(dto: CommitPaymentDto): CommitPaymentDto {
    return {
      ppeTransactionUuid: dto.ppeTransactionUuid,
      processId: dto.processId,
      qrCode: dto.qrCode,
      vehiclePlate: dto.vehiclePlate,
      targetAmount: dto.targetAmount,
      insertedAmount: dto.insertedAmount,
      changeAmount: dto.changeAmount,
      expectedOutcomeDatetime: dto.expectedOutcomeDatetime,
      committedBy: dto.committedBy,
    };
  }
}
