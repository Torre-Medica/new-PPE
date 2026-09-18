import { Inject, Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, DataSource, In, IsNull, LessThan, Repository } from 'typeorm';
import { CashChangeService } from '@modules/cash-management/application/cash-change.service';
import { CashInventoryService } from '@modules/cash-management/application/cash-inventory.service';
import { KioskEventsService } from '@modules/kiosk/application/kiosk-events.service';
import { KioskStateService } from '@modules/kiosk/application/kiosk-state.service';
import { ReturnChangeItem } from '@modules/peripherals/application/peripherals.service';
import { CashDenominationRejectedError } from '@modules/payment-core/domain/errors/cash-denomination-rejected.error';
import { InsufficientChangeError } from '@modules/payment-core/domain/errors/insufficient-change.error';
import { PaymentSessionConflictError } from '@modules/payment-core/domain/errors/payment-session-conflict.error';
import { PaymentSessionNotFoundError } from '@modules/payment-core/domain/errors/payment-session-not-found.error';
import {
  ACTIVE_SESSION_STATUSES,
  CASH_ACCEPTING_STATUSES,
  COMPLETABLE_STATUSES,
} from '@modules/payment-core/domain/payment-session-states';
import { ActivatePaymentCollectionDto } from '@modules/payment-core/application/dto/activate-payment-collection.dto';
import { CompleteSessionDto } from '@modules/payment-core/application/dto/complete-session.dto';
import { QueryCompletedPaymentsDto } from '@modules/payment-core/application/dto/query-completed-payments.dto';
import { RegisterCashDto } from '@modules/payment-core/application/dto/register-cash.dto';
import { RetryPendingCommitsDto } from '@modules/payment-core/application/dto/retry-pending-commits.dto';
import { StartPaymentSessionDto } from '@modules/payment-core/application/dto/start-payment-session.dto';
import { CashIncidentType } from '@modules/persistence/infrastructure/entities/cash-incident.entity';
import { PaymentLineEntity } from '@modules/persistence/infrastructure/entities/payment-line.entity';
import { PaymentSessionEventEntity } from '@modules/persistence/infrastructure/entities/payment-session-event.entity';
import {
  PaymentSessionEntity,
  PaymentSessionStatus,
  ServerSyncStatus,
} from '@modules/persistence/infrastructure/entities/payment-session.entity';
import {
  ServerSyncAttemptEntity,
  ServerSyncAttemptStatus,
  ServerSyncAttemptType,
} from '@modules/persistence/infrastructure/entities/server-sync-attempt.entity';
import { PeripheralsService } from '@modules/peripherals/application/peripherals.service';
import { QrScannedEvent } from '@modules/peripherals/interfaces/qr-events.interface';
import { GenerateMonthlySubscriptionDto } from '@modules/server-link/application/dto/monthly-subscription.dto';
import { NexoBackRestService } from '@modules/server-link/application/nexo-back-rest.service';
import { SERVER_LINK_PORT } from '@modules/server-link/domain/ports/server-link.port';
import type { ServerLinkPort } from '@modules/server-link/domain/ports/server-link.port';
import { DispenserSlotEntity } from '@modules/persistence/infrastructure/entities/dispenser-slot.entity';

type MonthlySubscriptionMetadata = {
  type: 'MONTHLY_SUBSCRIPTION';
  stage: 'CUSTOMER_LOOKUP' | 'AWAITING_PLATE' | 'VALIDATED';
  scannedCode: string;
  identificationCode: string;
  paddedFromEightDigits: boolean;
  customType?: 'Mensualidad' | 'Mensualidad Interna';
  monthsForPay?: number;
  validated?: boolean;
  plate?: string;
  vehicleKind?: string;
  concept?: string;
  total?: number;
  subtotal?: number;
  IVAPercentage?: number;
  IVATotal?: number;
  discountCode?: string;
  discountAmount?: number;
  customer?: Record<string, unknown>;
  service?: Record<string, unknown>;
  validationDetail?: Record<string, unknown>;
  validationResponse?: unknown;
  validationError?: string;
  validatedAt?: string;
};

type MonthlyIdentification = {
  scannedCode: string;
  identificationCode: string;
  paddedFromEightDigits: boolean;
};

@Injectable()
export class PaymentSessionService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(PaymentSessionService.name);
  private static readonly BILL_DENOMINATIONS = [1000, 2000, 5000, 10000, 20000, 50000, 100000];
  private static readonly QR_DEBOUNCE_WINDOW_MS = 1000;
  private static readonly TIMEOUT_CHECK_INTERVAL_MS = 10_000;
  // 4 intentos/min durante 5 min ≈ 20 intentos — el efectivo ya se recolecto
  // fisicamente, asi que reintentamos solos en vez de esperar a un operador.
  private static readonly AUTO_RETRY_INTERVAL_MS = 15_000;
  private static readonly AUTO_RETRY_WINDOW_MS = 5 * 60_000;
  // Red de seguridad ademas de la sincronizacion inmediata tras cada mutacion
  // de slots (carga, descarga, expulsion, dispensado de cambio, reembolso)
  private static readonly CASH_SYNC_INTERVAL_MS = 10 * 60_000;
  private lastProcessedQr: { qrCode: string; scannedAtMs: number } | null = null;
  private isProcessingQr = false;
  private sessionTimeoutInterval: NodeJS.Timeout | null = null;
  private autoRetryInterval: NodeJS.Timeout | null = null;
  private cashSyncInterval: NodeJS.Timeout | null = null;
  // Serializa el procesamiento de eventos de efectivo: evita que dos monedas/billetes
  // casi simultaneos abran transacciones concurrentes sobre la misma conexion SQLite
  private cashEventQueue: Promise<void> = Promise.resolve();

  constructor(
    @InjectRepository(PaymentSessionEntity)
    private readonly paymentSessionRepository: Repository<PaymentSessionEntity>,
    @InjectRepository(PaymentSessionEventEntity)
    private readonly paymentSessionEventRepository: Repository<PaymentSessionEventEntity>,
    @InjectRepository(PaymentLineEntity)
    private readonly paymentLineRepository: Repository<PaymentLineEntity>,
    @InjectRepository(ServerSyncAttemptEntity)
    private readonly syncAttemptRepository: Repository<ServerSyncAttemptEntity>,
    private readonly dataSource: DataSource,
    private readonly cashChangeService: CashChangeService,
    private readonly cashInventoryService: CashInventoryService,
    private readonly kioskEventsService: KioskEventsService,
    private readonly kioskStateService: KioskStateService,
    private readonly peripheralsService: PeripheralsService,
    @Inject(SERVER_LINK_PORT) private readonly serverLinkService: ServerLinkPort,
    private readonly nexoBackRestService: NexoBackRestService,
    private readonly configService: ConfigService,
  ) {}

  onApplicationBootstrap(): void {
    this.peripheralsService.onMoneyReceived((event) => {
      // Encolado: si llega otra moneda/billete mientras se procesa la anterior,
      // espera a que termine antes de iniciar su propia transaccion
      this.cashEventQueue = this.cashEventQueue
        .then(() => this.handlePeripheralMoneyEvent(event))
        .catch((error) => {
          this.logger.error(
            `Error procesando evento de efectivo en cola: ${error instanceof Error ? error.message : String(error)}`,
          );
        });
    });

    this.peripheralsService.onQrScanned((event) => {
      void this.handleQrScannedEvent(event);
    });

    this.startSessionTimeoutWatcher();
    this.startAutoRetryWatcher();

    this.syncCashInventoryToNexoBack();
    this.cashSyncInterval = setInterval(
      () => this.syncCashInventoryToNexoBack(),
      PaymentSessionService.CASH_SYNC_INTERVAL_MS,
    );
  }

  onModuleDestroy(): void {
    if (this.sessionTimeoutInterval) {
      clearInterval(this.sessionTimeoutInterval);
      this.sessionTimeoutInterval = null;
    }
    if (this.autoRetryInterval) {
      clearInterval(this.autoRetryInterval);
      this.autoRetryInterval = null;
    }
    if (this.cashSyncInterval) {
      clearInterval(this.cashSyncInterval);
      this.cashSyncInterval = null;
    }
  }

  /**
   * Envia a nexo_back (tabla paymentpoint) el efectivo actual de los 4 slots
   * de billetes/monedas del PPE. Fire-and-forget a proposito: si nexo_back
   * esta caido o el PPE aun no tiene IP autorizada alla, la operacion local
   * de carga, descarga, expulsion, dispensado de cambio o reembolso no debe
   * fallar ni bloquearse por esto.
   */
  syncCashInventoryToNexoBack(): void {
    this.peripheralsService
      .getDispenserSlots()
      .then((slots) => {
        const byKey = new Map(slots.map((slot) => [slot.slotKey, slot]));
        const amountOf = (slot?: DispenserSlotEntity) => (slot?.isActive ? slot.quantity : 0);
        const denominationOf = (slot?: DispenserSlotEntity) =>
          slot?.isActive && slot.denominationId ? slot.denominationId : 0;

        return this.nexoBackRestService.syncPaymentPointCash({
          bill1Denomination: denominationOf(byKey.get('bill1')),
          bill2Denomination: denominationOf(byKey.get('bill2')),
          coin1Denomination: denominationOf(byKey.get('coin1')),
          coin2Denomination: denominationOf(byKey.get('coin2')),
          bill1Amount: amountOf(byKey.get('bill1')),
          bill2Amount: amountOf(byKey.get('bill2')),
          coin1Amount: amountOf(byKey.get('coin1')),
          coin2Amount: amountOf(byKey.get('coin2')),
        });
      })
      .catch((error) => {
        this.logger.warn(
          `No fue posible sincronizar el efectivo con nexo_back: ${error instanceof Error ? error.message : String(error)}`,
        );
      });
  }

  async startSession(dto: StartPaymentSessionDto) {
    await this.assertPaymentModeEnabled();

    const blockingSession = await this.paymentSessionRepository.findOne({
      where: [
        {
          status: In(ACTIVE_SESSION_STATUSES),
        },
        {
          status: PaymentSessionStatus.CommittingToServer,
          serverSyncStatus: ServerSyncStatus.Pending,
        },
        {
          status: PaymentSessionStatus.CompletedWithWarning,
          serverSyncStatus: ServerSyncStatus.Rejected,
          serverPaymentId: IsNull(),
        },
      ],
      order: {
        createdAt: 'DESC',
      },
    });

    if (blockingSession) {
      if (ACTIVE_SESSION_STATUSES.includes(blockingSession.status)) {
        throw new PaymentSessionConflictError(
          `Ya existe una sesion activa (${blockingSession.id}) en estado ${blockingSession.status}`,
        );
      }

      throw new PaymentSessionConflictError(
        `No se puede iniciar un nuevo pago porque la sesion ${blockingSession.id} quedó pendiente por confirmar con el servidor (${blockingSession.status})`,
      );
    }

    const monthlyIdentification = this.resolveMonthlyIdentificationFromCode(dto.qrCode);
    if (monthlyIdentification && this.isMonthlySubscriptionsEnabled()) {
      return this.startMonthlySubscriptionSessionFromScan(monthlyIdentification, {
        source: 'simulator',
        rawCode: dto.qrCode,
        scannedAt: new Date().toISOString(),
        port: null,
      });
    }

    const session = await this.paymentSessionRepository.save(
      this.paymentSessionRepository.create({
        serverProcessId: dto.serverProcessId ?? null,
        serverPaymentId: null,
        serverSyncStatus: ServerSyncStatus.Pending,
        qrCode: dto.qrCode ?? null,
        vehiclePlate: dto.vehiclePlate ?? null,
        vehicleType: dto.vehicleType ?? null,
        identificationType: dto.identificationType ?? null,
        identificationCode: dto.identificationCode ?? null,
        concept: dto.concept ?? null,
        targetAmount: dto.targetAmount,
        insertedAmount: 0,
        changeAmount: 0,
        status: PaymentSessionStatus.Created,
        startedAt: new Date(),
        completedAt: null,
        failureReason: null,
        metadataJson: dto.metadataJson ?? null,
      }),
    );

    let validationResponse: unknown = null;
    let validationStatus = ServerSyncAttemptStatus.Success;
    if (session.qrCode || session.vehiclePlate) {
      const validationOutcome = await this.validateCandidateForSession(session.id, {
        ppeTransactionUuid: session.id,
        qrCode: session.qrCode,
        vehiclePlate: session.vehiclePlate,
      });
      validationResponse = validationOutcome.response;
      validationStatus = validationOutcome.status;

      const evaluation = this.evaluateQrValidationResponse(validationResponse);
      if (!evaluation.accepted) {
        await this.paymentSessionRepository.update(session.id, {
          status: PaymentSessionStatus.Failed,
          completedAt: new Date(),
          failureReason: evaluation.reason,
        });

        await this.appendEvent(session.id, evaluation.eventType, null, {
          qrCode: session.qrCode,
          vehiclePlate: session.vehiclePlate,
          reason: evaluation.reason,
          validationResponse,
        });

        return this.getSessionById(session.id);
      }

      await this.paymentSessionRepository.update(session.id, {
        serverProcessId: evaluation.serverProcessId,
        vehiclePlate: evaluation.vehiclePlate ?? session.vehiclePlate,
        vehicleType: evaluation.vehicleType ?? session.vehicleType,
        identificationType:
          evaluation.identificationType ?? session.identificationType,
        identificationCode:
          evaluation.identificationCode ?? session.identificationCode ?? session.qrCode,
        concept: evaluation.concept ?? session.concept,
        targetAmount: evaluation.amountDue,
        status: PaymentSessionStatus.Validated,
        failureReason: null,
        metadataJson: this.mergeMetadata(session.metadataJson, {
          validation: {
            startDatetime: this.resolveReviewDatetime(validationResponse, session.startedAt),
            paidDatetime: this.extractIsoString(validationResponse, 'paidDatetime'),
            expectedOutcomeDatetime: this.extractValidationDetailIsoString(
              validationResponse,
              'expectedOutcomeDatetime',
            ),
            incomeConditionType: evaluation.incomeConditionType,
            concept: evaluation.concept ?? session.concept,
            vehicleType: evaluation.vehicleType ?? session.vehicleType,
            vehiclePlate: evaluation.vehiclePlate ?? session.vehiclePlate,
            identificationType:
              evaluation.identificationType ?? session.identificationType,
            identificationCode:
              evaluation.identificationCode ??
              session.identificationCode ??
              session.qrCode,
          },
        }),
      });
    } else {
      await this.paymentSessionRepository.update(session.id, {
        status: PaymentSessionStatus.Validated,
      });
    }

    const currentTargetAmount =
      typeof validationResponse === 'object' &&
      validationResponse !== null &&
      typeof (validationResponse as Record<string, unknown>).amountDue === 'number'
        ? ((validationResponse as Record<string, unknown>).amountDue as number)
        : dto.targetAmount;

    const reviewedSession = await this.getSessionById(session.id);
    const acceptancePolicy = await this.cashInventoryService.getAcceptancePolicy(
      reviewedSession.targetAmount,
      reviewedSession.insertedAmount,
    );

    await this.appendEvent(session.id, 'payment.session.review-ready', currentTargetAmount, {
      qrCode: reviewedSession.qrCode,
      vehiclePlate: reviewedSession.vehiclePlate,
      serverProcessId: reviewedSession.serverProcessId,
      status: PaymentSessionStatus.Validated,
      validationResponse,
      acceptancePolicy,
    });

    this.kioskEventsService.emit('session.review-ready', {
      paymentSessionId: reviewedSession.id,
      qrCode: reviewedSession.qrCode,
      identificationType: reviewedSession.identificationType,
      identificationCode: reviewedSession.identificationCode,
      identifierLabel:
        reviewedSession.identificationType === 'CC' ? 'Cedula' : 'UUID',
      identifierValue:
        reviewedSession.identificationCode || reviewedSession.qrCode || '',
      vehiclePlate: reviewedSession.vehiclePlate,
      targetAmount: currentTargetAmount,
      enteredAt: this.resolveReviewDatetime(validationResponse, reviewedSession.startedAt),
      concept: reviewedSession.concept,
      acceptancePolicy,
    });

    return reviewedSession;
  }

  async getSessionById(sessionId: string) {
    const session = await this.paymentSessionRepository.findOne({
      where: { id: sessionId },
      relations: ['paymentLines', 'paymentLines.denomination', 'events'],
    });

    if (!session) {
      throw new PaymentSessionNotFoundError(sessionId);
    }

    return session;
  }

  async getActiveSession(): Promise<PaymentSessionEntity | null> {
    return this.paymentSessionRepository.findOne({
      where: { status: In(ACTIVE_SESSION_STATUSES) },
      order: { createdAt: 'DESC' },
    });
  }

  async getActiveSessionSummary(): Promise<Record<string, unknown> | null> {
    const session = await this.getActiveSession();
    if (!session) {
      return null;
    }

    const acceptancePolicy =
      [
        PaymentSessionStatus.Validated,
        PaymentSessionStatus.ListeningCash,
        PaymentSessionStatus.ChangePending,
        PaymentSessionStatus.ReadyToCommit,
      ].includes(session.status)
        ? await this.cashInventoryService.getAcceptancePolicy(
            session.targetAmount,
            session.insertedAmount,
          )
        : null;

    return this.buildKioskSessionSnapshot(session, acceptancePolicy);
  }

  async activateCollection(
    sessionId: string,
    dto: ActivatePaymentCollectionDto,
  ) {
    const session = await this.getSessionById(sessionId);

    if (session.status !== PaymentSessionStatus.Validated) {
      throw new PaymentSessionConflictError(
        `La sesion ${sessionId} no puede habilitar cobro desde el estado ${session.status}`,
      );
    }
    this.assertMonthlySubscriptionReadyForCollection(session);

    const acceptancePolicy = await this.cashInventoryService.getAcceptancePolicy(
      session.targetAmount,
      session.insertedAmount,
    );
    const electronicBilling = this.isElectronicBillingEnabled()
      ? dto.electronicBilling
      : undefined;
    const billingCustomerIdentification =
      electronicBilling?.customerIdentificationNumber?.trim() ?? '';

    if (electronicBilling?.enabled && !billingCustomerIdentification) {
      throw new PaymentSessionConflictError(
        'Debe validar o registrar el tercero antes de habilitar el cobro',
      );
    }

    const metadataJson =
      electronicBilling === undefined
        ? session.metadataJson
        : this.mergeMetadata(session.metadataJson, {
            electronicBilling: {
              enabled: electronicBilling.enabled,
              customerIdentificationNumber: electronicBilling.enabled
                ? billingCustomerIdentification
                : null,
              requestedAt: new Date().toISOString(),
            },
          });

    try {
      this.peripheralsService.activateAcceptance(acceptancePolicy.acceptedBillDenominations);
      await this.paymentSessionRepository.update(session.id, {
        status: PaymentSessionStatus.ListeningCash,
        metadataJson,
      });
      await this.appendEvent(session.id, 'payment.peripherals.acceptance-enabled', null, {
        source: 'peripherals',
        trigger: 'kiosk-collect',
        initiatedBy: dto.initiatedBy ?? 'kiosk',
        electronicBilling: electronicBilling ?? null,
      });
    } catch (activationError) {
      const reason =
        activationError instanceof Error
          ? activationError.message
          : 'Error al activar perifericos';
      this.logger.error(
        `[COLLECT] No se pudo activar la aceptacion de efectivo: ${reason}`,
      );
      await this.paymentSessionRepository.update(session.id, {
        status: PaymentSessionStatus.Failed,
        completedAt: new Date(),
        failureReason: reason,
      });
      await this.appendEvent(session.id, 'payment.peripherals.activation-failed', null, {
        reason,
        trigger: 'kiosk-collect',
      });
      return this.getSessionById(session.id);
    }

    const updatedSession = await this.getSessionById(session.id);
    await this.appendEvent(session.id, 'payment.session.started', updatedSession.targetAmount, {
      qrCode: updatedSession.qrCode,
      vehiclePlate: updatedSession.vehiclePlate,
      serverProcessId: updatedSession.serverProcessId,
      status: PaymentSessionStatus.ListeningCash,
      trigger: 'kiosk-collect',
    });

    this.kioskEventsService.emit('session.collecting-enabled', {
      paymentSessionId: updatedSession.id,
      targetAmount: updatedSession.targetAmount,
      insertedAmount: updatedSession.insertedAmount,
      acceptancePolicy,
      identifierLabel:
        updatedSession.identificationType === 'CC' ? 'Cedula' : 'UUID',
      identifierValue:
        updatedSession.identificationCode || updatedSession.qrCode || '',
    });

    this.kioskEventsService.emit('machine.low-change-warning', {
      paymentSessionId: updatedSession.id,
      acceptancePolicy,
    });

    return updatedSession;
  }

  async activateSimulatedCollection(
    sessionId: string,
    dto: ActivatePaymentCollectionDto,
  ) {
    const session = await this.getSessionById(sessionId);

    if (session.status !== PaymentSessionStatus.Validated) {
      throw new PaymentSessionConflictError(
        `La sesion ${sessionId} no puede habilitar cobro simulado desde el estado ${session.status}`,
      );
    }
    this.assertMonthlySubscriptionReadyForCollection(session);

    const acceptancePolicy = await this.cashInventoryService.getAcceptancePolicy(
      session.targetAmount,
      session.insertedAmount,
    );
    const electronicBilling = this.isElectronicBillingEnabled()
      ? dto.electronicBilling
      : undefined;
    const billingCustomerIdentification =
      electronicBilling?.customerIdentificationNumber?.trim() ?? '';

    if (electronicBilling?.enabled && !billingCustomerIdentification) {
      throw new PaymentSessionConflictError(
        'Debe validar o registrar el tercero antes de habilitar el cobro',
      );
    }

    const metadataJson =
      electronicBilling === undefined
        ? session.metadataJson
        : this.mergeMetadata(session.metadataJson, {
            electronicBilling: {
              enabled: electronicBilling.enabled,
              customerIdentificationNumber: electronicBilling.enabled
                ? billingCustomerIdentification
                : null,
              requestedAt: new Date().toISOString(),
              simulatedHardware: true,
            },
          });

    await this.paymentSessionRepository.update(session.id, {
      status: PaymentSessionStatus.ListeningCash,
      metadataJson,
    });

    const updatedSession = await this.getSessionById(session.id);
    await this.appendEvent(session.id, 'payment.sim.acceptance-enabled', null, {
      source: 'simulator',
      trigger: 'kiosk-sim-collect',
      initiatedBy: dto.initiatedBy ?? 'kiosk-sim',
      electronicBilling: electronicBilling ?? null,
      acceptancePolicy,
    });

    this.kioskEventsService.emit('session.collecting-enabled', {
      paymentSessionId: updatedSession.id,
      targetAmount: updatedSession.targetAmount,
      insertedAmount: updatedSession.insertedAmount,
      acceptancePolicy,
      identifierLabel:
        updatedSession.identificationType === 'CC' ? 'Cedula' : 'UUID',
      identifierValue:
        updatedSession.identificationCode || updatedSession.qrCode || '',
    });

    return updatedSession;
  }

  /**
   * Valida la mensualidad contra nexo_back con una placa ya resuelta del
   * lado del servidor (ver startMonthlySubscriptionSessionFromScan). No hay
   * endpoint HTTP publico para esto — el PPE nunca deja que el usuario
   * escriba o cambie la placa de una mensualidad, porque de eso depende la
   * tarifa (carro vs moto) que se le cobra.
   */
  private async applyMonthlyPlateValidation(
    sessionId: string,
    plateInput: string,
    monthsForPayInput?: number,
  ) {
    if (!this.isMonthlySubscriptionsEnabled()) {
      throw new PaymentSessionConflictError(
        'El pago de mensualidades no esta habilitado en este PPE',
      );
    }

    const session = await this.getSessionById(sessionId);
    if (session.status !== PaymentSessionStatus.Validated) {
      throw new PaymentSessionConflictError(
        `La sesion ${sessionId} no permite validar mensualidad desde el estado ${session.status}`,
      );
    }

    const monthlySubscription = this.extractMonthlySubscriptionFromMetadata(
      session.metadataJson,
    );
    if (!monthlySubscription) {
      throw new PaymentSessionConflictError(
        'La sesion actual no corresponde a un pago de mensualidad',
      );
    }

    const plate = this.normalizeMonthlyPlate(plateInput);
    const vehicleKind = this.resolveVehicleKindFromPlate(plate);
    if (!vehicleKind) {
      throw new PaymentSessionConflictError(
        "Campo 'Placa' no tiene formato de carro o de moto",
      );
    }

    const identificationCode =
      monthlySubscription.identificationCode || session.identificationCode || '';
    if (!identificationCode) {
      throw new PaymentSessionConflictError(
        'La sesion no tiene documento para validar la mensualidad',
      );
    }

    const monthsForPay =
      monthsForPayInput ?? monthlySubscription.monthsForPay ?? 1;
    const validationPayload = {
      identificationType: 'CC' as const,
      identificationCode,
      plate,
      discountCode: monthlySubscription.discountCode ?? '',
      isApportionment: false,
      customType: monthlySubscription.customType ?? 'Mensualidad',
      monthsForPay,
    };

    let validationResponse: unknown = null;
    let validationStatus = ServerSyncAttemptStatus.Success;

    try {
      validationResponse =
        await this.serverLinkService.validateMonthlySubscription(validationPayload);
    } catch (error) {
      validationStatus = ServerSyncAttemptStatus.Failed;
      validationResponse = {
        isSuccess: false,
        messageBody: error instanceof Error ? error.message : 'Error desconocido',
      };
    }

    await this.syncAttemptRepository.save(
      this.syncAttemptRepository.create({
        paymentSessionId: sessionId,
        requestType: ServerSyncAttemptType.Validate,
        requestJson: JSON.stringify({
          type: 'MONTHLY_SUBSCRIPTION_VALIDATE',
          ...validationPayload,
        }),
        responseJson: validationResponse ? JSON.stringify(validationResponse) : null,
        status: validationStatus,
      }),
    );

    const evaluation = this.evaluateMonthlyValidationResponse(validationResponse);
    if (!evaluation.accepted) {
      await this.paymentSessionRepository.update(session.id, {
        metadataJson: this.mergeMetadata(session.metadataJson, {
          monthlySubscription: {
            ...monthlySubscription,
            plate,
            vehicleKind,
            validated: false,
            stage: 'AWAITING_PLATE',
            validationError: evaluation.reason,
            validationResponse,
          },
        }),
      });

      await this.appendEvent(session.id, 'payment.monthly.validation-rejected', null, {
        identificationCode,
        plate,
        reason: evaluation.reason,
        validationResponse,
      });

      throw new PaymentSessionConflictError(evaluation.reason);
    }

    const metadataJson = this.mergeMetadata(session.metadataJson, {
      monthlySubscription: {
        ...monthlySubscription,
        stage: 'VALIDATED',
        validated: true,
        plate: evaluation.plate ?? plate,
        vehicleKind: evaluation.vehicleKind ?? vehicleKind,
        concept: evaluation.concept ?? monthlySubscription.customType ?? 'Mensualidad',
        total: evaluation.total,
        subtotal: evaluation.subtotal,
        IVAPercentage: evaluation.IVAPercentage,
        IVATotal: evaluation.IVATotal,
        discountCode: evaluation.discountCode,
        discountAmount: evaluation.discountAmount,
        monthsForPay,
        validationDetail: evaluation.validationDetail,
        validationResponse,
        validationError: undefined,
        validatedAt: new Date().toISOString(),
      },
    });

    await this.paymentSessionRepository.update(session.id, {
      vehiclePlate: evaluation.plate ?? plate,
      vehicleType: evaluation.vehicleKind ?? vehicleKind,
      identificationType: 'CC',
      identificationCode,
      concept: evaluation.concept ?? monthlySubscription.customType ?? 'Mensualidad',
      targetAmount: evaluation.total,
      failureReason: null,
      metadataJson,
    });

    const updatedSession = await this.getSessionById(session.id);
    const acceptancePolicy = await this.cashInventoryService.getAcceptancePolicy(
      updatedSession.targetAmount,
      updatedSession.insertedAmount,
    );

    await this.appendEvent(session.id, 'payment.monthly.validated', evaluation.total, {
      identificationCode,
      plate: updatedSession.vehiclePlate,
      vehicleKind: updatedSession.vehicleType,
      concept: updatedSession.concept,
      validationResponse,
      acceptancePolicy,
    });

    const snapshot = this.buildKioskSessionSnapshot(updatedSession, acceptancePolicy);
    this.kioskEventsService.emit('session.review-ready', snapshot);

    return snapshot;
  }

  async getSessionEvents(sessionId: string) {
    const session = await this.paymentSessionRepository.findOne({
      where: { id: sessionId },
    });

    if (!session) {
      throw new PaymentSessionNotFoundError(sessionId);
    }

    return this.paymentSessionEventRepository.find({
      where: { paymentSessionId: sessionId },
      order: { createdAt: 'ASC', id: 'ASC' },
    });
  }

  async cancelSession(sessionId: string) {
    const session = await this.getSessionById(sessionId);

    if (!ACTIVE_SESSION_STATUSES.includes(session.status)) {
      throw new PaymentSessionConflictError(
        `La sesion ${sessionId} no se puede cancelar desde el estado ${session.status}`,
      );
    }

    // Una vez el monto ya fue cubierto (ChangePending/DispensingChange/ReadyToCommit)
    // la sesion ya esta en proceso de auto-completarse (commit + entrega de cambio).
    // Cancelar aqui causaria un reembolso duplicado del efectivo ya procesado
    // correctamente (ej. una carrera de tiempo con un timeout obsoleto del frontend).
    if (
      session.status === PaymentSessionStatus.ChangePending ||
      session.status === PaymentSessionStatus.DispensingChange ||
      session.status === PaymentSessionStatus.ReadyToCommit
    ) {
      throw new PaymentSessionConflictError(
        `La sesion ${sessionId} ya cubrio el monto y se esta completando automaticamente, no se puede cancelar (estado ${session.status})`,
      );
    }

    // UPDATE condicionado al status ya leido (igual que timeoutSession): si dos
    // cancelaciones casi simultaneas (doble-tap) llegan aqui, solo la primera
    // afecta una fila — la segunda ve affected=0 y no reintenta el reembolso,
    // evitando devolver el mismo efectivo dos veces.
    const result = await this.paymentSessionRepository.update(
      { id: sessionId, status: session.status },
      {
        status: PaymentSessionStatus.Canceled,
        completedAt: new Date(),
        failureReason: 'Cancelada manualmente',
      },
    );

    if (!result.affected) {
      throw new PaymentSessionConflictError(
        `La sesion ${sessionId} ya fue modificada por otra operacion — no se repite la cancelacion`,
      );
    }

    this.peripheralsService.deactivateAcceptance();

    // Si se habia insertado efectivo antes de cancelar, devolverlo
    if (session.insertedAmount > 0) {
      await this.attemptRefund(session, 'CANCEL');
    }

    const cancelPayload = {
      ppeTransactionUuid: session.id,
      processId: session.serverProcessId,
      qrCode: session.qrCode,
      vehiclePlate: session.vehiclePlate,
      reason: 'Cancelada manualmente desde PPE',
    };

    let cancelResponse: unknown = null;
    let cancelStatus = ServerSyncAttemptStatus.Success;

    try {
      cancelResponse = await this.serverLinkService.cancelPayment(cancelPayload);
    } catch (error) {
      cancelStatus = ServerSyncAttemptStatus.Failed;
      cancelResponse = {
        error: error instanceof Error ? error.message : 'Error desconocido',
      };
    }

    await this.syncAttemptRepository.save(
      this.syncAttemptRepository.create({
        paymentSessionId: session.id,
        requestType: ServerSyncAttemptType.Cancel,
        requestJson: JSON.stringify(cancelPayload),
        responseJson: cancelResponse ? JSON.stringify(cancelResponse) : null,
        status: cancelStatus,
      }),
    );

    await this.appendEvent(sessionId, 'payment.session.canceled', null, {
      previousStatus: session.status,
      cancelResponse,
    });

    this.kioskEventsService.emit('session.canceled', {
      paymentSessionId: session.id,
      qrCode: session.qrCode,
      reason: 'Cancelada manualmente',
    });

    return this.getSessionById(sessionId);
  }

  async touchSessionActivity(sessionId: string) {
    const session = await this.getSessionById(sessionId);

    if (
      session.status !== PaymentSessionStatus.Validated &&
      session.status !== PaymentSessionStatus.ListeningCash &&
      session.status !== PaymentSessionStatus.ChangePending &&
      session.status !== PaymentSessionStatus.ReadyToCommit
    ) {
      return session;
    }

    await this.paymentSessionRepository.update(sessionId, {
      updatedAt: new Date(),
    });

    return this.getSessionById(sessionId);
  }

  async registerCash(sessionId: string, dto: RegisterCashDto) {
    const session = await this.getSessionById(sessionId);

    if (!CASH_ACCEPTING_STATUSES.includes(session.status)) {
      throw new PaymentSessionConflictError(
        `La sesion ${sessionId} no acepta efectivo en estado ${session.status}`,
      );
    }

    const totalAdded = dto.denominationId * dto.quantity;

    await this.dataSource.transaction(async (manager) => {
      await this.cashInventoryService.recordAcceptedCashWithManager(
        {
          denominationId: dto.denominationId,
          quantity: dto.quantity,
          paymentSessionId: sessionId,
          createdBy: dto.createdBy ?? 'payment-session',
        },
        manager,
      );

      const currentSession = await manager.findOneByOrFail(PaymentSessionEntity, {
        id: sessionId,
      });

      currentSession.insertedAmount += totalAdded;
      if (currentSession.insertedAmount >= currentSession.targetAmount) {
        currentSession.changeAmount =
          currentSession.insertedAmount - currentSession.targetAmount;
        currentSession.status =
          currentSession.changeAmount > 0
            ? PaymentSessionStatus.ChangePending
            : PaymentSessionStatus.ReadyToCommit;
      }

      await manager.save(PaymentSessionEntity, currentSession);

      const existingLine = await manager.findOne(PaymentLineEntity, {
        where: {
          paymentSessionId: sessionId,
          denominationId: dto.denominationId,
        },
      });

      if (existingLine) {
        existingLine.quantity += dto.quantity;
        existingLine.subtotal += totalAdded;
        await manager.save(PaymentLineEntity, existingLine);
      } else {
        await manager.save(
          PaymentLineEntity,
          manager.create(PaymentLineEntity, {
            paymentSessionId: sessionId,
            denominationId: dto.denominationId,
            quantity: dto.quantity,
            subtotal: totalAdded,
          }),
        );
      }

      await manager.save(
        PaymentSessionEventEntity,
        manager.create(PaymentSessionEventEntity, {
          paymentSessionId: sessionId,
          type: 'payment.cash.accepted',
          amount: totalAdded,
          payloadJson: JSON.stringify({
            denominationId: dto.denominationId,
            quantity: dto.quantity,
            createdBy: dto.createdBy ?? 'payment-session',
          }),
        }),
      );
    });

    const updatedSession = await this.getSessionById(sessionId);
    if (
      updatedSession.status === PaymentSessionStatus.ReadyToCommit ||
      updatedSession.status === PaymentSessionStatus.ChangePending
    ) {
      this.peripheralsService.deactivateAcceptance();
    }

    const acceptancePolicy =
      updatedSession.status === PaymentSessionStatus.ListeningCash
        ? await this.cashInventoryService.getAcceptancePolicy(
            updatedSession.targetAmount,
            updatedSession.insertedAmount,
          )
        : null;

    this.kioskEventsService.emit('cash.received', {
      paymentSessionId: updatedSession.id,
      denominationId: dto.denominationId,
      quantity: dto.quantity,
      status: updatedSession.status,
      insertedAmount: updatedSession.insertedAmount,
      targetAmount: updatedSession.targetAmount,
      pendingAmount: Math.max(0, updatedSession.targetAmount - updatedSession.insertedAmount),
      acceptancePolicy,
      readyToComplete:
        updatedSession.status === PaymentSessionStatus.ReadyToCommit ||
        updatedSession.status === PaymentSessionStatus.ChangePending,
    });

    return updatedSession;
  }

  private async assertAcceptedCashDenomination(
    session: PaymentSessionEntity,
    denominationId: number,
  ): Promise<void> {
    if (!PaymentSessionService.BILL_DENOMINATIONS.includes(denominationId)) {
      return;
    }

    const acceptancePolicy = await this.cashInventoryService.getAcceptancePolicy(
      session.targetAmount,
      session.insertedAmount,
    );

    if (acceptancePolicy.acceptedBillDenominations.includes(denominationId)) {
      return;
    }

    throw new CashDenominationRejectedError(
      denominationId,
      acceptancePolicy.maxAcceptedBill,
    );
  }

  async completeSession(sessionId: string, dto: CompleteSessionDto) {
    const session = await this.getSessionById(sessionId);
    if (!COMPLETABLE_STATUSES.includes(session.status)) {
      throw new PaymentSessionConflictError(
        `La sesion ${sessionId} no puede completarse desde el estado ${session.status}`,
      );
    }

    const committedBy = dto.committedBy ?? 'payment-session';

    if (session.changeAmount > 0) {
      // Leer configuración de slots desde la DB (qué denominación está cargada en cada dispensador)
      const slotConfig = await this.peripheralsService.getDispenserSlotConfig();
      const dispensableDenominations = new Set(
        [slotConfig.bill1, slotConfig.bill2, slotConfig.coin1, slotConfig.coin2].filter(
          (d): d is number => d !== null && d > 0,
        ),
      );

      const changePlan = await this.cashChangeService.planChange(
        session.changeAmount,
        dispensableDenominations,
      );

      await this.appendEvent(sessionId, 'payment.change.pending', session.changeAmount, {
        committedBy,
        changePlan,
        slotConfig,
      });

      if (changePlan.remaining > 0) {
        const smallestDispensable = await this.cashInventoryService.getSmallestDispensableDenomination();
        // Si no hay ninguna tolva activa (smallestDispensable=Infinity), NUNCA se
        // escribe como novedad — es una falla de configuracion real, no un
        // remanente estructural, y remaining >= Infinity nunca seria true.
        if (!Number.isFinite(smallestDispensable) || changePlan.remaining >= smallestDispensable) {
          throw new InsufficientChangeError(session.changeAmount, changePlan.remaining);
        }

        // Remanente estructural (menor a la denominacion minima cargada hoy, ej.
        // $50 cuando solo hay monedas de $100+): no es un problema de stock que se
        // arregle recargando, es fisicamente irrepresentable con lo que la maquina
        // puede dispensar. Se redondea a favor del inventario de la maquina y se
        // registra como novedad en vez de bloquear la sesion.
        await this.cashInventoryService.recordCashIncident({
          type: CashIncidentType.UndispensableChange,
          amount: changePlan.remaining,
          paymentSessionId: sessionId,
          createdBy: 'system',
        });
        await this.appendEvent(sessionId, 'payment.change.rounding-writeoff', changePlan.remaining, {
          reason: 'Remanente menor a la denominacion minima disponible, no se pudo devolver',
          remaining: changePlan.remaining,
        });
      }

      await this.paymentSessionRepository.update(sessionId, {
        status: PaymentSessionStatus.DispensingChange,
      });

      this.logger.log(
        `[CAMBIO] Devolviendo $${session.changeAmount.toLocaleString('es-CO')} COP` +
        ` | Plan: ${changePlan.items.map((i) => `${i.quantity}x$${i.denominationId.toLocaleString('es-CO')}`).join(', ')}` +
        ` | bill1=${slotConfig.bill1 ?? '-'} bill2=${slotConfig.bill2 ?? '-'}` +
        ` coin1=${slotConfig.coin1 ?? '-'} coin2=${slotConfig.coin2 ?? '-'}`,
      );

      const denominationToSlot = new Map<number, ReturnChangeItem['slotKey']>(
        (Object.entries(slotConfig) as Array<[ReturnChangeItem['slotKey'], number | null]>)
          .filter((e): e is [ReturnChangeItem['slotKey'], number] => e[1] !== null && e[1] > 0)
          .map(([key, den]) => [den, key]),
      );
      const returnItems: ReturnChangeItem[] = changePlan.items
        .filter((item) => denominationToSlot.has(item.denominationId))
        .map((item) => ({
          slotKey: denominationToSlot.get(item.denominationId)!,
          denomination: item.denominationId,
          quantity: item.quantity,
        }));

      // returnChange() manda un solo trama con el total y las 4 denominaciones —
      // la placa reparte internamente. No hay ACK por denominacion individual que
      // confirmar (a diferencia de returnChangeReliable, que quedo reservado para
      // el boton de prueba "Expulsar", donde si necesitamos apuntar a un solo
      // slot sin ambiguedad). El numero que se cuadra de verdad es el total de
      // dinero en tolvas (changeInventoryTotal), ajustado por el operador en cada
      // cierre contra el conteo fisico — no el desglose exacto por denominacion.
      const commandAudit = await this.peripheralsService.returnChange(returnItems);

      await this.paymentSessionRepository.update(sessionId, {
        changeCommandsJson: JSON.stringify(commandAudit),
      });

      this.syncCashInventoryToNexoBack();

      await this.appendEvent(sessionId, 'payment.change.dispensed', session.changeAmount, {
        committedBy,
        items: changePlan.items,
        slotConfig,
        commandAudit,
      });
    }

    this.peripheralsService.deactivateAcceptance();
    const updatedSession = await this.commitSessionToServer(session, committedBy);

    this.kioskEventsService.emit('session.completed', {
      paymentSessionId: updatedSession.id,
      qrCode: updatedSession.qrCode,
      insertedAmount: updatedSession.insertedAmount,
      targetAmount: updatedSession.targetAmount,
      changeAmount: updatedSession.changeAmount,
      completedAt: updatedSession.completedAt?.toISOString() ?? null,
      serverPaymentId: updatedSession.serverPaymentId,
      // El frontend necesita distinguir esto para NO decirle al cliente "puede
      // retirar su vehiculo" cuando el servidor central (quien controla la
      // salida) nunca confirmo el pago — sin esto la pantalla mostraba el mismo
      // mensaje de exito aunque el commit hubiera fallado/quedado sin confirmar.
      status: updatedSession.status,
      paymentRegistered: updatedSession.serverSyncStatus === ServerSyncStatus.Confirmed,
    });

    this.logger.log(
      `\n` +
      `╔══════════════════════════════════════════════════════╗\n` +
      `║  PAGO COMPLETADO                                     ║\n` +
      `╠══════════════════════════════════════════════════════╣\n` +
      `║  Sesion    : ${sessionId.slice(0, 38).padEnd(38)} ║\n` +
      `║  Ingresado : $${session.insertedAmount.toLocaleString('es-CO').padStart(10)} COP                       ║\n` +
      `║  Cambio    : $${session.changeAmount.toLocaleString('es-CO').padStart(10)} COP                       ║\n` +
      `║  Servidor  : ${String(updatedSession.serverPaymentId ?? 'sin confirmar').padEnd(38)} ║\n` +
      `║  Estado    : ${updatedSession.status.padEnd(38)} ║\n` +
      `╚══════════════════════════════════════════════════════╝`,
    );

    return updatedSession;
  }

  async retryPendingCommits(dto: RetryPendingCommitsDto) {
    const limit = dto.limit ?? 20;
    const candidates = await this.paymentSessionRepository.find({
      where: [
        {
          status: PaymentSessionStatus.CompletedWithWarning,
          serverSyncStatus: ServerSyncStatus.Rejected,
          serverPaymentId: IsNull(),
        },
        {
          status: PaymentSessionStatus.CommittingToServer,
          serverSyncStatus: ServerSyncStatus.Pending,
          serverPaymentId: IsNull(),
        },
      ],
      order: {
        updatedAt: 'ASC',
      },
      take: limit,
    });

    const results: Array<Record<string, unknown>> = [];

    for (const candidate of candidates) {
      await this.appendEvent(candidate.id, 'payment.sync.retry.requested', null, {
        previousStatus: candidate.status,
      });

      try {
        const retried = await this.commitSessionToServer(
          candidate,
          'retry-pending-commits',
        );

        results.push({
          paymentSessionId: candidate.id,
          status: retried.status,
          serverPaymentId: retried.serverPaymentId,
          serverSyncStatus: retried.serverSyncStatus,
        });
      } catch (error) {
        await this.appendEvent(candidate.id, 'payment.sync.retry.failed', null, {
          message: error instanceof Error ? error.message : 'Error desconocido',
        });

        results.push({
          paymentSessionId: candidate.id,
          status: 'FAILED_RETRY',
          error: error instanceof Error ? error.message : 'Error desconocido',
        });
      }
    }

    return {
      attempted: candidates.length,
      results,
    };
  }

  private startAutoRetryWatcher(): void {
    this.autoRetryInterval = setInterval(() => {
      void this.autoRetryPendingCommits();
    }, PaymentSessionService.AUTO_RETRY_INTERVAL_MS);
  }

  /**
   * El efectivo de estas sesiones ya se recolecto/dispenso fisicamente — lo
   * unico pendiente es que el servidor confirme el pago. En vez de esperar a
   * que un operador reintente manualmente, el PPE reintenta solo durante una
   * ventana acotada (AUTO_RETRY_WINDOW_MS, ~5 min a este intervalo). Pasada
   * esa ventana sin exito, se deja de reintentar automaticamente y se avisa
   * al operador — un pago que sigue sin confirmar despues de 5 min reintentando
   * probablemente necesita revision humana, no mas intentos silenciosos.
   */
  private async autoRetryPendingCommits(): Promise<void> {
    const candidates = await this.paymentSessionRepository.find({
      where: [
        {
          status: PaymentSessionStatus.CompletedWithWarning,
          serverSyncStatus: ServerSyncStatus.Rejected,
          serverPaymentId: IsNull(),
        },
        {
          status: PaymentSessionStatus.CommittingToServer,
          serverSyncStatus: ServerSyncStatus.Pending,
          serverPaymentId: IsNull(),
        },
      ],
      order: { updatedAt: 'ASC' },
      take: 20,
    });

    for (const candidate of candidates) {
      try {
        await this.autoRetryOneSession(candidate);
      } catch (error) {
        this.logger.error(
          `[AUTO-RETRY] Error reintentando sesion ${candidate.id}: ` +
          `${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }

  private async autoRetryOneSession(candidate: PaymentSessionEntity): Promise<void> {
    // El timestamp del PRIMER intento de commit (server_sync_attempts es
    // append-only, nunca se actualiza) es la unica referencia que no se
    // "resetea" con cada reintento — completedAt/updatedAt SI se resetean en
    // cada intento, asi que no sirven para medir la ventana de 5 minutos.
    const firstAttempt = await this.syncAttemptRepository.findOne({
      where: {
        paymentSessionId: candidate.id,
        requestType: ServerSyncAttemptType.Commit,
      },
      order: { createdAt: 'ASC' },
    });

    const windowStart = firstAttempt?.createdAt ?? candidate.completedAt ?? candidate.updatedAt;
    const elapsedMs = Date.now() - windowStart.getTime();

    if (elapsedMs >= PaymentSessionService.AUTO_RETRY_WINDOW_MS) {
      // Ya se evita reintentar de nuevo: si ya se emitio el aviso de
      // agotamiento antes, no repetirlo en cada tick.
      const alreadyExhausted = await this.paymentSessionEventRepository.findOne({
        where: { paymentSessionId: candidate.id, type: 'payment.sync.exhausted' },
      });
      if (alreadyExhausted) {
        return;
      }

      this.logger.error(
        `[AUTO-RETRY] Sesion ${candidate.id} sin confirmar tras ${Math.round(elapsedMs / 1000)}s ` +
        `de reintentos automaticos — se requiere revision manual.`,
      );
      await this.appendEvent(candidate.id, 'payment.sync.exhausted', candidate.insertedAmount, {
        reason: 'El servidor no confirmo el pago tras la ventana de reintentos automaticos',
        windowMs: PaymentSessionService.AUTO_RETRY_WINDOW_MS,
      });
      this.kioskEventsService.emit('machine.payment-unconfirmed', {
        paymentSessionId: candidate.id,
        insertedAmount: candidate.insertedAmount,
        reason:
          'El pago se recolecto pero el servidor no lo confirmo tras varios intentos — ' +
          'requiere resolucion manual de un operador',
      });
      return;
    }

    await this.appendEvent(candidate.id, 'payment.sync.retry.requested', null, {
      previousStatus: candidate.status,
      auto: true,
    });

    try {
      await this.commitSessionToServer(candidate, 'auto-retry');
    } catch (error) {
      await this.appendEvent(candidate.id, 'payment.sync.retry.failed', null, {
        message: error instanceof Error ? error.message : 'Error desconocido',
        auto: true,
      });
    }
  }

  async listCompletedPayments(query: QueryCompletedPaymentsDto) {
    const whereClause: Record<string, unknown> = {
      status:
        query.status ??
        In([
          PaymentSessionStatus.Completed,
          PaymentSessionStatus.CompletedWithWarning,
        ]),
    };

    if (query.qrCode) {
      whereClause.qrCode = query.qrCode;
    }

    if (query.ppeTransactionUuid) {
      whereClause.id = query.ppeTransactionUuid;
    }

    if (query.serverPaymentId) {
      whereClause.serverPaymentId = query.serverPaymentId;
    }

    if (query.dateFrom || query.dateTo) {
      const from = query.dateFrom ? new Date(query.dateFrom) : new Date('2000-01-01T00:00:00.000Z');
      const to = query.dateTo ? new Date(query.dateTo) : new Date('2999-12-31T23:59:59.999Z');
      whereClause.completedAt = Between(from, to);
    }

    return this.paymentSessionRepository.find({
      where: whereClause,
      order: { completedAt: 'DESC', createdAt: 'DESC' },
      take: 500,
    });
  }

  async getCompletedPaymentByQrCode(qrCode: string) {
    const session = await this.paymentSessionRepository.findOne({
      where: {
        qrCode,
        status: In([
          PaymentSessionStatus.Completed,
          PaymentSessionStatus.CompletedWithWarning,
        ]),
      },
      order: {
        completedAt: 'DESC',
      },
    });

    if (!session) {
      return {
        exists: false,
        qrCode,
      };
    }

    return {
      exists: true,
      qrCode,
      ppeTransactionUuid: session.id,
      serverPaymentId: session.serverPaymentId,
      status: session.status,
      targetAmount: session.targetAmount,
      insertedAmount: session.insertedAmount,
      changeAmount: session.changeAmount,
      completedAt: session.completedAt,
    };
  }

  private async appendEvent(
    paymentSessionId: string,
    type: string,
    amount: number | null,
    payload: Record<string, unknown> | null,
  ) {
    await this.paymentSessionEventRepository.save(
      this.paymentSessionEventRepository.create({
        paymentSessionId,
        type,
        amount,
        payloadJson: payload ? JSON.stringify(payload) : null,
      }),
    );
  }

  private async commitSessionToServer(
    session: PaymentSessionEntity,
    committedBy: string,
  ) {
    await this.paymentSessionRepository.update(session.id, {
      status: PaymentSessionStatus.CommittingToServer,
    });

    const electronicBilling = this.extractElectronicBillingFromMetadata(
      session.metadataJson,
    );
    const monthlySubscription = this.extractMonthlySubscriptionFromMetadata(
      session.metadataJson,
    );
    const commitPayload = {
      ppeTransactionUuid: session.id,
      processId: session.serverProcessId,
      qrCode: session.qrCode,
      vehiclePlate: session.vehiclePlate,
      targetAmount: session.targetAmount,
      insertedAmount: session.insertedAmount,
      changeAmount: session.changeAmount,
      expectedOutcomeDatetime: this.extractExpectedOutcomeDatetimeFromMetadata(
        session.metadataJson,
      ),
      committedBy,
    };
    const payloadForCommit = electronicBilling.enabled
      ? {
          ...commitPayload,
          vehicleType: session.vehicleType,
          identificationType: session.identificationType,
          identificationCode: session.identificationCode,
          concept: session.concept,
          customerIdentificationNumber:
            electronicBilling.customerIdentificationNumber,
        }
      : commitPayload;
    const monthlyPayloadForCommit =
      monthlySubscription?.validated === true
        ? this.buildMonthlySubscriptionGeneratePayload(
            session,
            monthlySubscription,
            committedBy,
          )
        : null;
    const requestPayloadForSync = monthlyPayloadForCommit ?? payloadForCommit;

    let response: unknown = null;
    let syncStatus = ServerSyncAttemptStatus.Success;

    try {
      response = monthlyPayloadForCommit
        ? await this.serverLinkService.generateMonthlySubscriptionPayment(
            monthlyPayloadForCommit,
            session.id,
          )
        : await this.serverLinkService.commitPayment(payloadForCommit);
    } catch (error) {
      syncStatus = ServerSyncAttemptStatus.Failed;
      response = {
        error: error instanceof Error ? error.message : 'Error desconocido',
      };
    }

    await this.syncAttemptRepository.save(
      this.syncAttemptRepository.create({
        paymentSessionId: session.id,
        requestType: ServerSyncAttemptType.Commit,
        requestJson: JSON.stringify(requestPayloadForSync),
        responseJson: response ? JSON.stringify(response) : null,
        status: syncStatus,
      }),
    );

    const responseRecord =
      typeof response === 'object' && response !== null
        ? (response as Record<string, unknown>)
        : {};
    const paymentRegistered = responseRecord.paymentRegistered === true;
    const serverPaymentId =
      typeof responseRecord.serverPaymentId === 'number'
        ? responseRecord.serverPaymentId
        : null;

    const finalStatus = paymentRegistered
      ? PaymentSessionStatus.Completed
      : PaymentSessionStatus.CompletedWithWarning;

    await this.paymentSessionRepository.update(session.id, {
      status: finalStatus,
      serverSyncStatus: paymentRegistered
        ? ServerSyncStatus.Confirmed
        : ServerSyncStatus.Rejected,
      serverPaymentId,
      completedAt: new Date(),
      failureReason: paymentRegistered
        ? null
        : 'El servidor principal no confirmo el pago',
      metadataJson: this.mergeMetadata(session.metadataJson, {
        commit: {
          paymentRegistered,
          allowedToExit: responseRecord.allowedToExit === true,
          paidDatetime:
            typeof responseRecord.paidDatetime === 'string'
              ? responseRecord.paidDatetime
              : null,
          exitUntil:
            typeof responseRecord.exitUntil === 'string'
              ? responseRecord.exitUntil
              : null,
          serverPaymentId,
        },
      }),
    });

    const updatedSession = await this.getSessionById(session.id);
    await this.appendEvent(session.id, 'payment.session.completed', session.targetAmount, {
      committedBy,
      serverPaymentId,
      paymentRegistered,
      response: responseRecord,
    });

    return updatedSession;
  }

  private async handlePeripheralMoneyEvent(event: {
    source: string;
    amount: number;
  }) {
    const activeSession = await this.paymentSessionRepository.findOne({
      where: {
        status: In([PaymentSessionStatus.ListeningCash]),
      },
      order: {
        createdAt: 'DESC',
      },
    });

    if (!activeSession) {
      if (this.peripheralsService.isCollectorTestModeEnabled()) {
        this.peripheralsService.recordCollectorTestSample({
          source: event.source,
          amount: event.amount,
          kind: event.source.includes('COIN') ? 'COIN' : 'BILL',
          receivedAt: new Date().toISOString(),
        });
        this.kioskEventsService.emit('collector.sample-received', {
          source: event.source,
          amount: event.amount,
          kind: event.source.includes('COIN') ? 'COIN' : 'BILL',
          receivedAt: new Date().toISOString(),
        });
        this.logger.log(
          `[COLLECTOR][TEST] ${event.source.includes('COIN') ? 'moneda' : 'billete'} ${event.amount}`,
        );
        return;
      }

      this.logger.warn(
        `Billete/moneda recibido (${event.amount} COP) sin sesion activa — ignorado`,
      );
      return;
    }

    try {
      const updatedSession = await this.registerCash(activeSession.id, {
        denominationId: event.amount,
        quantity: 1,
        createdBy: event.source,
      });
      const pending = Math.max(0, updatedSession.targetAmount - updatedSession.insertedAmount);
      const acceptancePolicy =
        updatedSession.status === PaymentSessionStatus.ListeningCash
          ? await this.cashInventoryService.getAcceptancePolicy(
              updatedSession.targetAmount,
              updatedSession.insertedAmount,
            )
          : null;

      if (acceptancePolicy) {
        this.peripheralsService.activateAcceptance(acceptancePolicy.acceptedBillDenominations);
      }

      this.kioskEventsService.emit('machine.low-change-warning', {
        paymentSessionId: updatedSession.id,
        acceptancePolicy,
      });

      this.logger.log(
        `[EFECTIVO] +$${event.amount.toLocaleString('es-CO')} COP (${event.source})` +
        ` | Acumulado: $${updatedSession.insertedAmount.toLocaleString('es-CO')}` +
        ` / $${updatedSession.targetAmount.toLocaleString('es-CO')}` +
        (pending > 0
          ? ` | Falta: $${pending.toLocaleString('es-CO')} COP`
          : ` | MONTO COMPLETO${updatedSession.changeAmount > 0 ? ` — Cambio: $${updatedSession.changeAmount.toLocaleString('es-CO')} COP` : ''}`),
      );

      if (
        updatedSession.status === PaymentSessionStatus.ReadyToCommit ||
        updatedSession.status === PaymentSessionStatus.ChangePending
      ) {
        this.logger.log(`[AUTO] Monto cubierto — cerrando sesion ${activeSession.id} automaticamente`);
        void this.autoCompleteSession(activeSession.id);
      }
    } catch (error) {
      // Denominacion no reconocida en tabla maestra o error de inventario
      const message = error instanceof Error ? error.message : 'Error desconocido';
      this.logger.error(
        `No se pudo registrar efectivo de ${event.source} (${event.amount} COP) en sesion ${activeSession.id}: ${message}`,
      );
      await this.appendEvent(activeSession.id, 'payment.cash.rejected', event.amount, {
        source: event.source,
        amount: event.amount,
        reason: message,
      });

      if (event.amount === 50000 || event.amount === 100000) {
        // El billete de $50.000/$100.000 nunca debe contarse como dinero recibido
        // (ya no se llego a llamar registerCash con exito). Bloquear la maquina es
        // lo critico para la seguridad del efectivo, asi que va primero y sin
        // depender de que el registro de la novedad (best-effort, ver abajo) tenga
        // exito — un fallo ahi jamas debe dejar la maquina aceptando dinero.
        this.peripheralsService.deactivateAcceptance();
        await this.kioskStateService.setPaymentsBlocked(
          true,
          'system',
          `Billete de $${event.amount.toLocaleString('es-CO')} no aceptado — requiere devolucion manual por un operador`,
        );
        this.kioskEventsService.emit('machine.large-bill-blocked', {
          paymentSessionId: activeSession.id,
          amount: event.amount,
          reason: 'Billete no aceptado por la maquina — contacte al operador para su devolucion',
        });

        try {
          await this.cashInventoryService.recordCashIncident({
            type: CashIncidentType.RejectedLargeBill,
            amount: event.amount,
            denominationId: event.amount,
            paymentSessionId: activeSession.id,
            createdBy: 'system',
          });
        } catch (incidentError) {
          this.logger.error(
            `No se pudo registrar la novedad de billete rechazado ($${event.amount}) para sesion ${activeSession.id}: ` +
            `${incidentError instanceof Error ? incidentError.message : String(incidentError)}`,
          );
        }
      }
    }
  }

  private async autoCompleteSession(sessionId: string): Promise<void> {
    try {
      await this.completeSession(sessionId, { committedBy: 'auto' });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Error desconocido';

      if (error instanceof InsufficientChangeError) {
        this.logger.error(
          `[AUTO] Cambio insuficiente para sesion ${sessionId}: ${message}`,
        );
        this.peripheralsService.deactivateAcceptance();
        await this.paymentSessionRepository.update(sessionId, {
          status: PaymentSessionStatus.Failed,
          completedAt: new Date(),
          failureReason: message,
        });
        await this.appendEvent(sessionId, 'payment.change.insufficient', null, {
          reason: message,
          alert: 'Se requiere recarga manual de dispensador',
        });
        return;
      }

      this.logger.error(
        `[AUTO] Error al cerrar automaticamente la sesion ${sessionId}: ${message}`,
      );
      await this.appendEvent(sessionId, 'payment.session.auto-complete-failed', null, {
        reason: message,
      });

      // Error inesperado (no InsufficientChangeError): el dinero pudo haberse
      // dispensado ya (returnChange corre antes del commit), pero la sesion
      // puede quedar atascada indefinidamente — el watcher de timeouts reintenta
      // completar/comitear sesiones en ChangePending/DispensingChange/ReadyToCommit,
      // y esas sesiones NO pueden cancelarse (bloqueado a proposito). Sin este
      // aviso, el cliente se queda viendo la pantalla de cobro congelada sin
      // ninguna explicacion mientras el sistema reintenta en silencio.
      this.peripheralsService.deactivateAcceptance();
      await this.kioskStateService.setPaymentsBlocked(
        true,
        'system',
        'Error inesperado completando un pago — requiere revision de un operador',
      );
      this.kioskEventsService.emit('machine.session-error', {
        paymentSessionId: sessionId,
        reason: 'Ocurrio un error inesperado — contacte al operador',
      });
    }
  }

  private async handleQrScannedEvent(event: QrScannedEvent): Promise<void> {
    if (this.isProcessingQr) {
      this.logger.warn(`QR ignorado porque ya hay una lectura en proceso: ${event.qrCode}`);
      this.kioskEventsService.emit('qr.ignored', {
        qrCode: event.qrCode,
        reason: 'Ya hay una lectura QR en proceso',
      });
      return;
    }

    const paymentAvailability = await this.kioskStateService.assertPaymentAvailability();
    if (!paymentAvailability.allowed) {
      this.logger.warn(`QR ignorado porque el PPE no esta en modo cobro: ${event.qrCode}`);
      this.kioskEventsService.emit('qr.ignored', {
        qrCode: event.qrCode,
        reason: paymentAvailability.reason ?? 'El PPE no esta disponible para cobro',
      });
      return;
    }

    const scannedAtMs = Date.parse(event.scannedAt) || Date.now();
    if (
      this.lastProcessedQr &&
      scannedAtMs - this.lastProcessedQr.scannedAtMs < PaymentSessionService.QR_DEBOUNCE_WINDOW_MS
    ) {
      this.logger.warn(
        `QR ${event.qrCode} ignorado por debounce global (${PaymentSessionService.QR_DEBOUNCE_WINDOW_MS} ms)`,
      );
      this.kioskEventsService.emit('qr.ignored', {
        qrCode: event.qrCode,
        reason: `Debounce de ${PaymentSessionService.QR_DEBOUNCE_WINDOW_MS} ms activo`,
      });
      return;
    }

    this.lastProcessedQr = {
      qrCode: event.qrCode,
      scannedAtMs,
    };
    this.isProcessingQr = true;

    try {
      const activeSession = await this.paymentSessionRepository.findOne({
        where: {
          status: In(ACTIVE_SESSION_STATUSES),
        },
        order: {
          createdAt: 'DESC',
        },
      });

      if (activeSession) {
        await this.appendEvent(activeSession.id, 'payment.qr.validation-rejected', null, {
          qrCode: event.qrCode,
          reason: `Ya existe una sesion activa (${activeSession.id}) en estado ${activeSession.status}`,
        });
        this.logger.warn(
          `QR ignorado porque ya existe una sesion activa (${activeSession.id}) en estado ${activeSession.status}`,
        );
        this.kioskEventsService.emit('qr.ignored', {
          qrCode: event.qrCode,
          reason: `Ya existe un pago en proceso (${activeSession.status})`,
        });
        return;
      }

      const monthlyIdentification = this.resolveMonthlyIdentificationFromCode(
        event.qrCode,
      );

      // Notificar al kiosko que el codigo fue recibido y se esta validando con el servidor
      this.kioskEventsService.emit('qr.processing', {
        qrCode: event.qrCode,
        scanType:
          monthlyIdentification && this.isMonthlySubscriptionsEnabled()
            ? 'MONTHLY_SUBSCRIPTION'
            : 'VISITOR',
      });

      if (monthlyIdentification && this.isMonthlySubscriptionsEnabled()) {
        await this.startMonthlySubscriptionSessionFromScan(monthlyIdentification, {
          source: event.source,
          rawCode: event.rawCode,
          scannedAt: event.scannedAt,
          port: event.port,
        });
        return;
      }

      const session = await this.paymentSessionRepository.save(
        this.paymentSessionRepository.create({
          serverProcessId: null,
          serverPaymentId: null,
          serverSyncStatus: ServerSyncStatus.Pending,
          qrCode: event.qrCode,
          vehiclePlate: null,
          vehicleType: null,
          identificationType: null,
          identificationCode: null,
          concept: null,
          targetAmount: 0,
          insertedAmount: 0,
          changeAmount: 0,
          status: PaymentSessionStatus.Validating,
          startedAt: new Date(),
          completedAt: null,
          failureReason: null,
          metadataJson: JSON.stringify({
            source: event.source,
            rawCode: event.rawCode,
            scannedAt: event.scannedAt,
            port: event.port,
          }),
        }),
      );

      await this.appendEvent(session.id, 'payment.qr.received', null, {
        qrCode: event.qrCode,
        rawCode: event.rawCode,
        scannedAt: event.scannedAt,
        port: event.port,
      });

      const validationOutcome = await this.validateCandidateForSession(session.id, {
        ppeTransactionUuid: session.id,
        qrCode: event.qrCode,
        vehiclePlate: null,
      });
      const validationResponse = validationOutcome.response;

      const evaluation = this.evaluateQrValidationResponse(validationResponse);
      if (!evaluation.accepted) {
        await this.paymentSessionRepository.update(session.id, {
          status: PaymentSessionStatus.Failed,
          completedAt: new Date(),
          failureReason: evaluation.reason,
        });

        await this.appendEvent(session.id, evaluation.eventType, null, {
          qrCode: event.qrCode,
          reason: evaluation.reason,
          validationResponse,
        });

        this.logger.warn(
          `\n` +
          `╔══════════════════════════════════════════════════════╗\n` +
          `║  QR RECHAZADO                                        ║\n` +
          `╠══════════════════════════════════════════════════════╣\n` +
          `║  QR     : ${event.qrCode.slice(0, 41).padEnd(41)} ║\n` +
          `║  Motivo : ${evaluation.reason.slice(0, 41).padEnd(41)} ║\n` +
          `╚══════════════════════════════════════════════════════╝`,
        );

        // El frontend queda esperando en "Validando..." tras 'qr.processing' si no
        // recibe ninguna notificacion de vuelta. Reutilizamos 'qr.ignored' (mismo
        // listener que ya regresa la pantalla a idle) para mostrar el motivo real.
        this.kioskEventsService.emit('qr.ignored', {
          qrCode: event.qrCode,
          reason: evaluation.reason,
        });
        return;
      }

      await this.paymentSessionRepository.update(session.id, {
        serverProcessId: evaluation.serverProcessId,
        vehiclePlate: evaluation.vehiclePlate,
        vehicleType: evaluation.vehicleType,
        identificationType: evaluation.identificationType,
        identificationCode: evaluation.identificationCode ?? event.qrCode,
        concept: evaluation.concept,
        targetAmount: evaluation.amountDue,
        status: PaymentSessionStatus.Validated,
        failureReason: null,
        metadataJson: this.mergeMetadata(session.metadataJson, {
          validation: {
            startDatetime: this.resolveReviewDatetime(validationResponse, session.startedAt),
            paidDatetime: this.extractIsoString(validationResponse, 'paidDatetime'),
            expectedOutcomeDatetime: this.extractValidationDetailIsoString(
              validationResponse,
              'expectedOutcomeDatetime',
            ),
            incomeConditionType: evaluation.incomeConditionType,
            concept: evaluation.concept,
            vehicleType: evaluation.vehicleType,
            vehiclePlate: evaluation.vehiclePlate,
            identificationType: evaluation.identificationType,
            identificationCode: evaluation.identificationCode ?? event.qrCode,
          },
        }),
      });

      const reviewedSession = await this.getSessionById(session.id);
      const acceptancePolicy = await this.cashInventoryService.getAcceptancePolicy(
        reviewedSession.targetAmount,
        reviewedSession.insertedAmount,
      );

      await this.appendEvent(session.id, 'payment.qr.accepted', evaluation.amountDue, {
        qrCode: event.qrCode,
        amountDue: evaluation.amountDue,
        serverProcessId: evaluation.serverProcessId,
        vehiclePlate: evaluation.vehiclePlate,
        vehicleType: evaluation.vehicleType,
        concept: evaluation.concept,
        validationResponse,
        acceptancePolicy,
      });

      await this.appendEvent(session.id, 'payment.session.review-ready', evaluation.amountDue, {
        qrCode: event.qrCode,
        vehiclePlate: evaluation.vehiclePlate,
        serverProcessId: evaluation.serverProcessId,
        status: PaymentSessionStatus.Validated,
        trigger: 'qr-scanned',
        acceptancePolicy,
      });

      this.kioskEventsService.emit('session.review-ready', {
        paymentSessionId: reviewedSession.id,
        qrCode: event.qrCode,
        identificationType: reviewedSession.identificationType,
        identificationCode: reviewedSession.identificationCode,
        identifierLabel:
          reviewedSession.identificationType === 'CC' ? 'Cedula' : 'UUID',
        identifierValue:
          reviewedSession.identificationCode || reviewedSession.qrCode || '',
        vehiclePlate: evaluation.vehiclePlate,
        targetAmount: evaluation.amountDue,
        concept: evaluation.concept,
        enteredAt: this.resolveReviewDatetime(validationResponse, reviewedSession.startedAt),
        acceptancePolicy,
      });

      this.logger.log(
        `\n` +
        `╔══════════════════════════════════════════════════════╗\n` +
        `║  QR ACEPTADO — ESPERANDO PAGO                       ║\n` +
        `╠══════════════════════════════════════════════════════╣\n` +
        `║  QR        : ${event.qrCode.slice(0, 38).padEnd(38)} ║\n` +
        `║  Placa     : ${(evaluation.vehiclePlate ?? '-').padEnd(38)} ║\n` +
        `║  Concepto  : ${(evaluation.concept ?? '-').slice(0, 38).padEnd(38)} ║\n` +
        `║  MONTO     : $${evaluation.amountDue.toLocaleString('es-CO').padStart(10)} COP                       ║\n` +
        `║  Sesion    : ${session.id.slice(0, 38).padEnd(38)} ║\n` +
        `╚══════════════════════════════════════════════════════╝`,
      );
    } finally {
      this.isProcessingQr = false;
    }
  }

  private async startMonthlySubscriptionSessionFromScan(
    monthlyIdentification: MonthlyIdentification,
    scanContext: {
      source: string;
      rawCode?: string | null;
      scannedAt: string;
      port?: string | null;
    },
  ): Promise<PaymentSessionEntity> {
    const session = await this.paymentSessionRepository.save(
      this.paymentSessionRepository.create({
        serverProcessId: null,
        serverPaymentId: null,
        serverSyncStatus: ServerSyncStatus.Pending,
        qrCode: monthlyIdentification.scannedCode,
        vehiclePlate: null,
        vehicleType: null,
        identificationType: 'CC',
        identificationCode: monthlyIdentification.identificationCode,
        concept: 'Mensualidad',
        targetAmount: 0,
        insertedAmount: 0,
        changeAmount: 0,
        status: PaymentSessionStatus.Validating,
        startedAt: new Date(),
        completedAt: null,
        failureReason: null,
        metadataJson: JSON.stringify({
          source: scanContext.source,
          rawCode: scanContext.rawCode,
          scannedAt: scanContext.scannedAt,
          port: scanContext.port,
          monthlySubscription: {
            type: 'MONTHLY_SUBSCRIPTION',
            stage: 'CUSTOMER_LOOKUP',
            scannedCode: monthlyIdentification.scannedCode,
            identificationCode: monthlyIdentification.identificationCode,
            paddedFromEightDigits: monthlyIdentification.paddedFromEightDigits,
            monthsForPay: 1,
            validated: false,
          } satisfies MonthlySubscriptionMetadata,
        }),
      }),
    );

    await this.appendEvent(session.id, 'payment.monthly.received', null, {
      scannedCode: monthlyIdentification.scannedCode,
      identificationCode: monthlyIdentification.identificationCode,
      paddedFromEightDigits: monthlyIdentification.paddedFromEightDigits,
      source: scanContext.source,
      rawCode: scanContext.rawCode,
      scannedAt: scanContext.scannedAt,
      port: scanContext.port,
    });

    try {
      const preparation = await this.serverLinkService.prepareMonthlySubscription(
        monthlyIdentification.identificationCode,
      );

      // La placa NUNCA la escribe el usuario en el PPE: sale del scheduling
      // principal de la cedula (observation -> {"plate":"..."}), resuelto en
      // NexoBackRestService.resolvePlateFromScheduling. Si no hay una placa
      // valida registrada, no hay forma segura de saber que tarifa (carro vs
      // moto) le corresponde — dejar que la escriba equivaldria a dejarlo
      // elegir su propia tarifa. Se rechaza el pago y se remite a caseta.
      const resolvedPlate = preparation.customer.resolvedPlate;
      if (!resolvedPlate) {
        throw new Error(
          'No hay una placa registrada para esta cedula. Pago no permitido, realice su primer pago en caseta.',
        );
      }

      const metadataJson = this.mergeMetadata(session.metadataJson, {
        monthlySubscription: {
          type: 'MONTHLY_SUBSCRIPTION',
          stage: 'AWAITING_PLATE',
          scannedCode: monthlyIdentification.scannedCode,
          identificationCode: preparation.identificationCode,
          paddedFromEightDigits: monthlyIdentification.paddedFromEightDigits,
          customType: preparation.customType,
          monthsForPay: 1,
          validated: false,
          customer: preparation.customer,
          service: preparation.service,
        } satisfies MonthlySubscriptionMetadata,
      });

      await this.paymentSessionRepository.update(session.id, {
        status: PaymentSessionStatus.Validated,
        identificationType: 'CC',
        identificationCode: preparation.identificationCode,
        concept: preparation.customType,
        failureReason: null,
        metadataJson,
      });

      await this.appendEvent(session.id, 'payment.monthly.customer-found', null, {
        identificationCode: preparation.identificationCode,
        customer: preparation.customer,
        service: preparation.service,
        resolvedPlate,
      });

      this.logger.log(
        `[MENSUALIDAD] Cedula ${preparation.identificationCode} registrada. Placa resuelta automaticamente (${resolvedPlate}) | Sesion: ${session.id}`,
      );

      // Valida de una vez contra nexo_back (monto, vigencia, etc.) — ya no
      // existe un paso intermedio de "esperando que el usuario teclee la
      // placa": si esto rechaza, cae al catch de abajo igual que cualquier
      // otro fallo de validacion.
      await this.applyMonthlyPlateValidation(session.id, resolvedPlate, 1);

      return this.getSessionById(session.id);
    } catch (error) {
      const reason =
        error instanceof Error
          ? error.message
          : 'No fue posible validar la cedula para mensualidad';

      await this.paymentSessionRepository.update(session.id, {
        status: PaymentSessionStatus.Failed,
        completedAt: new Date(),
        failureReason: reason,
        metadataJson: this.mergeMetadata(session.metadataJson, {
          monthlySubscription: {
            type: 'MONTHLY_SUBSCRIPTION',
            stage: 'CUSTOMER_LOOKUP',
            scannedCode: monthlyIdentification.scannedCode,
            identificationCode: monthlyIdentification.identificationCode,
            paddedFromEightDigits: monthlyIdentification.paddedFromEightDigits,
            monthsForPay: 1,
            validated: false,
            validationError: reason,
          } satisfies MonthlySubscriptionMetadata,
        }),
      });

      await this.appendEvent(session.id, 'payment.monthly.validation-rejected', null, {
        scannedCode: monthlyIdentification.scannedCode,
        identificationCode: monthlyIdentification.identificationCode,
        reason,
      });
      this.kioskEventsService.emit('qr.ignored', {
        qrCode: monthlyIdentification.scannedCode,
        reason,
      });

      this.logger.warn(
        `[MENSUALIDAD] Cedula ${monthlyIdentification.identificationCode} rechazada: ${reason}`,
      );

      return this.getSessionById(session.id);
    }
  }

  private evaluateQrValidationResponse(response: unknown): {
    accepted: boolean;
    eventType: string;
    reason: string;
    amountDue: number;
    serverProcessId: number | null;
    vehiclePlate: string | null;
    vehicleType: string | null;
    concept: string | null;
    incomeConditionType: string | null;
    identificationType: string | null;
    identificationCode: string | null;
  } {
    const responseRecord =
      typeof response === 'object' && response !== null
        ? (response as Record<string, unknown>)
        : {};

    const status = typeof responseRecord.status === 'string'
      ? responseRecord.status.toUpperCase()
      : null;

    const amountDueCandidate = [
      responseRecord.amountDue,
      responseRecord.total,
      responseRecord.targetAmount,
    ].find((value) => typeof value === 'number' && Number.isFinite(value));

    const amountDue = typeof amountDueCandidate === 'number' ? amountDueCandidate : 0;
    const paidStatus = this.normalizePaidStatus(responseRecord.paidStatus);
    // nexo_back no manda alreadyPaid/paidStatus/status='ALREADY_PAID': indica que no
    // hay cobro pendiente con messageTitle 'No requiere cobro' (ya pagado) o
    // 'Tiempo de gracia' (aun dentro del periodo gratuito).
    const messageTitle =
      typeof responseRecord.messageTitle === 'string' ? responseRecord.messageTitle : null;
    const noPaymentRequiredTitle =
      messageTitle === 'No requiere cobro' || messageTitle === 'Tiempo de gracia';
    const alreadyPaid =
      responseRecord.alreadyPaid === true ||
      paidStatus === 'PAID' ||
      status === 'ALREADY_PAID' ||
      noPaymentRequiredTitle;

    const explicitPayable =
      responseRecord.payable === true ||
      responseRecord.accepted === true ||
      status === 'PENDING_PAYMENT';

    if (alreadyPaid) {
      const friendlyReason =
        messageTitle === 'Tiempo de gracia'
          ? 'Aun esta en tiempo de gracia, no requiere pago'
          : 'Tiquete ya pagado, no requiere pago adicional';
      return {
        accepted: false,
        eventType: 'payment.qr.already-paid',
        reason: friendlyReason,
        amountDue: 0,
        serverProcessId: null,
        vehiclePlate: null,
        vehicleType: null,
        concept: null,
        incomeConditionType: null,
        identificationType: null,
        identificationCode: null,
      };
    }

    if (status === 'INVALID_QR') {
      return {
        accepted: false,
        eventType: 'payment.qr.invalid',
        reason: 'El QR no es valido para cobro',
        amountDue: 0,
        serverProcessId: null,
        vehiclePlate: null,
        vehicleType: null,
        concept: null,
        incomeConditionType: null,
        identificationType: null,
        identificationCode: null,
      };
    }

    if (status === 'NOT_FOUND' || status === 'EXPIRED' || status === 'BLOCKED' || status === 'SERVER_ERROR') {
      return {
        accepted: false,
        eventType: 'payment.qr.validation-rejected',
        reason:
          status === 'NOT_FOUND'
            ? 'El servidor no encontro el QR'
            : status === 'EXPIRED'
              ? 'El QR expiro y no puede cobrarse'
              : status === 'BLOCKED'
                ? 'El QR fue bloqueado y no puede cobrarse'
                : 'No fue posible validar el QR con el servidor',
        amountDue: 0,
        serverProcessId: null,
        vehiclePlate: null,
        vehicleType: null,
        concept: null,
        incomeConditionType: null,
        identificationType: null,
        identificationCode: null,
      };
    }

    if (responseRecord.accepted === false && !explicitPayable) {
      // No dependemos del texto exacto que mande nexo_back (puede variar o venir
      // con problemas de codificacion) - mensaje fijo y claro para el usuario.
      return {
        accepted: false,
        eventType: 'payment.qr.no-process',
        reason:
          'No se encontro un proceso de ingreso para este QR. Verifique su registro ' +
          'de entrada en el punto de acceso del parqueadero.',
        amountDue: 0,
        serverProcessId: null,
        vehiclePlate: null,
        vehicleType: null,
        concept: null,
        incomeConditionType: null,
        identificationType: null,
        identificationCode: null,
      };
    }

    if (!explicitPayable && amountDue <= 0) {
      return {
        accepted: false,
        eventType: 'payment.qr.validation-rejected',
        reason: 'El servidor no reporto un saldo pendiente cobrable para el QR',
        amountDue: 0,
        serverProcessId: null,
        vehiclePlate: null,
        vehicleType: null,
        concept: null,
        incomeConditionType: null,
        identificationType: null,
        identificationCode: null,
      };
    }

    if (amountDue <= 0) {
      // Llegar aqui significa que nexo_back encontro un proceso valido
      // (accepted: true / explicitPayable) pero no hay monto pendiente. El
      // endpoint real de nexo_back (ppe.gateway.ts) nunca manda messageTitle,
      // asi que no podemos distinguir "ya pagado" de "tiempo de gracia" aqui -
      // en ambos casos el mensaje correcto para el usuario es el mismo: no debe
      // pagar nada en este momento.
      return {
        accepted: false,
        eventType: 'payment.qr.already-paid',
        reason: 'No requiere pago en este momento (ya pagado o en tiempo de gracia)',
        amountDue: 0,
        serverProcessId: null,
        vehiclePlate: null,
        vehicleType: null,
        concept: null,
        incomeConditionType: null,
        identificationType: null,
        identificationCode: null,
      };
    }

    return {
      accepted: true,
      eventType: 'payment.qr.accepted',
      reason: 'QR aceptado para cobro',
      amountDue,
      serverProcessId:
        typeof responseRecord.processId === 'number'
          ? responseRecord.processId
          : typeof responseRecord.serverProcessId === 'number'
            ? responseRecord.serverProcessId
            : null,
      vehiclePlate:
        typeof responseRecord.vehiclePlate === 'string' ? responseRecord.vehiclePlate : null,
      vehicleType:
        typeof responseRecord.vehicleType === 'string' ? responseRecord.vehicleType : null,
      concept: typeof responseRecord.concept === 'string' ? responseRecord.concept : null,
      incomeConditionType:
        typeof responseRecord.incomeConditionType === 'string'
          ? responseRecord.incomeConditionType
          : null,
      identificationType:
        typeof responseRecord.identificationType === 'string'
          ? responseRecord.identificationType
          : null,
      identificationCode:
        typeof responseRecord.identificationCode === 'string'
          ? responseRecord.identificationCode
          : null,
    };
  }

  private startSessionTimeoutWatcher(): void {
    const validatingTimeoutMs = this.configService.get<number>(
      'payment.sessionValidatingTimeoutMs',
      15_000,
    );
    const reviewTimeoutMs = this.configService.get<number>(
      'payment.sessionReviewTimeoutMs',
      10_000,
    );
    const cashTimeoutMs = this.configService.get<number>(
      'payment.sessionCashTimeoutMs',
      120_000,
    );

    this.sessionTimeoutInterval = setInterval(() => {
      void this.checkSessionTimeouts(
        validatingTimeoutMs,
        reviewTimeoutMs,
        cashTimeoutMs,
      );
    }, PaymentSessionService.TIMEOUT_CHECK_INTERVAL_MS);
  }

  private async checkSessionTimeouts(
    validatingTimeoutMs: number,
    reviewTimeoutMs: number,
    cashTimeoutMs: number,
  ): Promise<void> {
    const now = new Date();
    const validatingThreshold = new Date(now.getTime() - validatingTimeoutMs);
    const reviewThreshold = new Date(now.getTime() - reviewTimeoutMs);
    const cashThreshold = new Date(now.getTime() - cashTimeoutMs);

    const stuckValidating = (await this.paymentSessionRepository.find({
      where: {
        status: PaymentSessionStatus.Validating,
        startedAt: LessThan(validatingThreshold),
      },
    })) ?? [];

    const stuckReview = (await this.paymentSessionRepository.find({
      where: {
        status: PaymentSessionStatus.Validated,
        updatedAt: LessThan(reviewThreshold),
      },
    })) ?? [];

    // Sesiones aun colectando dinero que superaron el timeout — hay que expirarlas y devolver lo insertado
    const stuckListeningCash = (await this.paymentSessionRepository.find({
      where: {
        status: PaymentSessionStatus.ListeningCash,
        updatedAt: LessThan(cashThreshold),
      },
    })) ?? [];

    // Sesiones con monto completo que no terminaron — hay que completarlas, no expirarlas
    const stuckReadyToProcess = (await this.paymentSessionRepository.find({
      where: {
        status: In([
          PaymentSessionStatus.ChangePending,
          PaymentSessionStatus.ReadyToCommit,
        ]),
        updatedAt: LessThan(cashThreshold),
      },
    })) ?? [];

    const stuckDispensing = (await this.paymentSessionRepository.find({
      where: {
        status: PaymentSessionStatus.DispensingChange,
        updatedAt: LessThan(cashThreshold),
      },
    })) ?? [];

    for (const session of [...stuckValidating, ...stuckReview, ...stuckListeningCash]) {
      await this.timeoutSession(session);
    }

    for (const session of stuckReadyToProcess) {
      this.logger.warn(
        `Sesion ${session.id} en ${session.status} sin actividad — completando automaticamente`,
      );
      void this.autoCompleteSession(session.id);
    }

    for (const session of stuckDispensing) {
      this.logger.warn(
        `Sesion ${session.id} lleva demasiado tiempo en DispensingChange — intentando commit`,
      );
      void this.commitSessionToServer(session, 'timeout-dispense-recovery').catch((err) => {
        this.logger.error(
          `No fue posible hacer commit de sesion ${session.id} en timeout: ${err instanceof Error ? err.message : String(err)}`,
        );
      });
    }
  }

  private async timeoutSession(session: PaymentSessionEntity): Promise<void> {
    try {
      const result = await this.paymentSessionRepository.update(
        { id: session.id, status: session.status },
        {
          status: PaymentSessionStatus.Timeout,
          completedAt: new Date(),
          failureReason: `Sesion expirada por inactividad en estado ${session.status}`,
        },
      );

      if (!result.affected) {
        return; // Otra operacion ya cerro la sesion
      }

      this.peripheralsService.deactivateAcceptance();

      await this.appendEvent(session.id, 'payment.session.timeout', null, {
        previousStatus: session.status,
        startedAt: session.startedAt.toISOString(),
        insertedAmount: session.insertedAmount,
      });

      // Si se insertó dinero sin completar el pago, intentar devolverlo
      if (session.insertedAmount > 0 && session.status === PaymentSessionStatus.ListeningCash) {
        await this.attemptRefund(session, 'TIMEOUT');
      }

      this.kioskEventsService.emit('session.timeout', {
        paymentSessionId: session.id,
        qrCode: session.qrCode,
        previousStatus: session.status,
        insertedAmount: session.insertedAmount,
      });

      this.logger.warn(
        `Sesion ${session.id} expirada por timeout desde estado ${session.status}` +
        (session.insertedAmount > 0
          ? ` — $${session.insertedAmount.toLocaleString('es-CO')} COP insertados, iniciando devolucion`
          : ''),
      );
    } catch (error) {
      this.logger.error(
        `Error al expirar sesion ${session.id}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private async attemptRefund(
    session: PaymentSessionEntity,
    context: 'TIMEOUT' | 'CANCEL',
  ): Promise<void> {
    try {
      const slotConfig = await this.peripheralsService.getDispenserSlotConfig();
      const dispensableDenominations = new Set(
        [slotConfig.bill1, slotConfig.bill2, slotConfig.coin1, slotConfig.coin2].filter(
          (d): d is number => d !== null && d > 0,
        ),
      );

      const refundPlan = await this.cashChangeService.planChange(
        session.insertedAmount,
        dispensableDenominations,
      );

      if (refundPlan.remaining > 0) {
        const smallestDispensable = await this.cashInventoryService.getSmallestDispensableDenomination();
        // Si no hay ninguna tolva activa (smallestDispensable=Infinity), nunca se
        // escribe como novedad — es una falla de configuracion real.
        if (!Number.isFinite(smallestDispensable) || refundPlan.remaining >= smallestDispensable) {
          this.logger.error(
            `[${context}][DEVOLUCION] Dispensador sin efectivo suficiente para devolver ` +
            `$${session.insertedAmount.toLocaleString('es-CO')} COP de sesion ${session.id}. ` +
            `Faltante: $${refundPlan.remaining.toLocaleString('es-CO')} COP. REQUIERE ATENCION MANUAL.`,
          );
          await this.appendEvent(session.id, 'payment.refund-failed', session.insertedAmount, {
            reason: 'Dispensador sin efectivo suficiente',
            insertedAmount: session.insertedAmount,
            remaining: refundPlan.remaining,
            alert: 'REQUIERE DEVOLUCION MANUAL',
            context,
          });
          this.kioskEventsService.emit('machine.refund-alert', {
            paymentSessionId: session.id,
            insertedAmount: session.insertedAmount,
            reason: 'No fue posible devolver automaticamente el dinero — contacte al operador',
          });
          return;
        }

        // Remanente estructural (< denominacion minima cargada): se devuelve lo
        // representable (refundPlan.items, mas abajo) y el resto se redondea a
        // favor del inventario de la maquina, registrado como novedad.
        await this.cashInventoryService.recordCashIncident({
          type: CashIncidentType.UndispensableChange,
          amount: refundPlan.remaining,
          paymentSessionId: session.id,
          createdBy: 'system',
        });
        await this.appendEvent(session.id, 'payment.refund.rounding-writeoff', refundPlan.remaining, {
          reason: 'Remanente menor a la denominacion minima disponible, no se pudo devolver',
          remaining: refundPlan.remaining,
          context,
        });
      }

      const denominationToSlot = new Map<number, ReturnChangeItem['slotKey']>(
        (Object.entries(slotConfig) as Array<[ReturnChangeItem['slotKey'], number | null]>)
          .filter((e): e is [ReturnChangeItem['slotKey'], number] => e[1] !== null && e[1] > 0)
          .map(([key, den]) => [den, key]),
      );

      const returnItems: ReturnChangeItem[] = refundPlan.items
        .filter((item) => denominationToSlot.has(item.denominationId))
        .map((item) => ({
          slotKey: denominationToSlot.get(item.denominationId)!,
          denomination: item.denominationId,
          quantity: item.quantity,
        }));

      // returnChange() manda un solo trama con el total y las 4 denominaciones —
      // ver el comentario equivalente en el flujo de cambio automatico mas arriba
      // en este archivo.
      const commandAudit = await this.peripheralsService.returnChange(returnItems);
      // Garantizar que billetero y placa queden desactivados tras dispensar
      this.peripheralsService.deactivateAcceptance();
      this.syncCashInventoryToNexoBack();

      await this.appendEvent(session.id, 'payment.refunded', session.insertedAmount, {
        insertedAmount: session.insertedAmount,
        refundPlan: refundPlan.items,
        commandAudit,
        context,
      });

      this.logger.log(
        `[${context}][DEVOLUCION] Devueltos $${session.insertedAmount.toLocaleString('es-CO')} COP` +
        ` | Sesion: ${session.id}` +
        ` | Plan: ${refundPlan.items.map((i) => `${i.quantity}x$${i.denominationId.toLocaleString('es-CO')}`).join(', ')}`,
      );
    } catch (error) {
      this.logger.error(
        `[${context}][DEVOLUCION] Error al devolver $${session.insertedAmount.toLocaleString('es-CO')} COP` +
        ` de sesion ${session.id}: ${error instanceof Error ? error.message : String(error)}`,
      );
      await this.appendEvent(session.id, 'payment.refund-error', session.insertedAmount, {
        error: error instanceof Error ? error.message : String(error),
        alert: 'REQUIERE DEVOLUCION MANUAL',
        context,
      });
      this.kioskEventsService.emit('machine.refund-alert', {
        paymentSessionId: session.id,
        insertedAmount: session.insertedAmount,
        reason: 'Error al dispensar el efectivo — se requiere devolucion manual',
      });
      // Asegurar desactivación incluso si el dispensado falló
      this.peripheralsService.deactivateAcceptance();
    }
  }

  private normalizePaidStatus(value: unknown): string | null {
    if (typeof value === 'boolean') {
      return value ? 'PAID' : 'PENDING';
    }

    if (typeof value === 'string') {
      return value.trim().toUpperCase();
    }

    return null;
  }

  private async assertPaymentModeEnabled(): Promise<void> {
    const availability = await this.kioskStateService.assertPaymentAvailability();
    if (!availability.allowed) {
      throw new PaymentSessionConflictError(
        availability.reason ?? 'El PPE no se encuentra disponible para cobro',
      );
    }
  }

  private buildKioskSessionSnapshot(
    session: PaymentSessionEntity,
    acceptancePolicy: Record<string, unknown> | null = null,
  ) {
    const monthlySubscription = this.extractMonthlySubscriptionFromMetadata(
      session.metadataJson,
    );

    return {
      paymentSessionId: session.id,
      status: session.status,
      sessionType: monthlySubscription ? 'MONTHLY_SUBSCRIPTION' : 'VISITOR',
      qrCode: session.qrCode,
      identificationType: session.identificationType,
      identificationCode: session.identificationCode,
      identifierLabel: session.identificationType === 'CC' ? 'Cedula' : 'UUID',
      identifierValue: session.identificationCode || session.qrCode || '',
      targetAmount: session.targetAmount,
      insertedAmount: session.insertedAmount,
      changeAmount: session.changeAmount,
      concept: session.concept,
      vehiclePlate: session.vehiclePlate,
      enteredAt: session.startedAt.toISOString(),
      startedAt: session.startedAt.toISOString(),
      acceptancePolicy,
      monthlySubscription,
    };
  }

  private resolveReviewDatetime(
    validationResponse: unknown,
    fallbackDate: Date,
  ): string {
    const responseRecord =
      typeof validationResponse === 'object' && validationResponse !== null
        ? (validationResponse as Record<string, unknown>)
        : {};

    if (typeof responseRecord.startDatetime === 'string') {
      return responseRecord.startDatetime;
    }

    if (responseRecord.startDatetime instanceof Date) {
      return responseRecord.startDatetime.toISOString();
    }

    return fallbackDate.toISOString();
  }

  private extractIsoString(source: unknown, key: string): string | null {
    const record =
      typeof source === 'object' && source !== null
        ? (source as Record<string, unknown>)
        : {};

    return typeof record[key] === 'string' ? (record[key] as string) : null;
  }

  private extractValidationDetailIsoString(
    source: unknown,
    key: string,
  ): string | null {
    const record =
      typeof source === 'object' && source !== null
        ? (source as Record<string, unknown>)
        : {};
    const detail =
      typeof record.validationDetail === 'object' && record.validationDetail !== null
        ? (record.validationDetail as Record<string, unknown>)
        : {};

    return typeof detail[key] === 'string' ? (detail[key] as string) : null;
  }

  private extractExpectedOutcomeDatetimeFromMetadata(
    metadataRaw: string | null,
  ): string | null {
    if (!metadataRaw) {
      return null;
    }

    try {
      const metadata = JSON.parse(metadataRaw) as {
        validation?: { expectedOutcomeDatetime?: string | null };
      };
      return metadata.validation?.expectedOutcomeDatetime ?? null;
    } catch {
      return null;
    }
  }

  private extractMonthlySubscriptionFromMetadata(
    metadataRaw: string | null,
  ): MonthlySubscriptionMetadata | null {
    if (!this.isMonthlySubscriptionsEnabled() || !metadataRaw) {
      return null;
    }

    const metadata = this.parseMetadata(metadataRaw);
    const monthlySubscription = this.asRecord(metadata.monthlySubscription);
    if (monthlySubscription.type !== 'MONTHLY_SUBSCRIPTION') {
      return null;
    }

    const stage = this.readString(monthlySubscription.stage);
    const identificationCode = this.readString(monthlySubscription.identificationCode);
    const scannedCode = this.readString(monthlySubscription.scannedCode);

    if (!identificationCode || !scannedCode) {
      return null;
    }

    return {
      type: 'MONTHLY_SUBSCRIPTION',
      stage:
        stage === 'VALIDATED' || stage === 'AWAITING_PLATE'
          ? stage
          : 'CUSTOMER_LOOKUP',
      scannedCode,
      identificationCode,
      paddedFromEightDigits: monthlySubscription.paddedFromEightDigits === true,
      customType:
        monthlySubscription.customType === 'Mensualidad Interna'
          ? 'Mensualidad Interna'
          : monthlySubscription.customType === 'Mensualidad'
            ? 'Mensualidad'
            : undefined,
      monthsForPay: this.readNumber(monthlySubscription.monthsForPay) ?? 1,
      validated: monthlySubscription.validated === true,
      plate: this.readString(monthlySubscription.plate) ?? undefined,
      vehicleKind: this.readString(monthlySubscription.vehicleKind) ?? undefined,
      concept: this.readString(monthlySubscription.concept) ?? undefined,
      total: this.readNumber(monthlySubscription.total) ?? undefined,
      subtotal: this.readNumber(monthlySubscription.subtotal) ?? undefined,
      IVAPercentage: this.readNumber(monthlySubscription.IVAPercentage) ?? undefined,
      IVATotal: this.readNumber(monthlySubscription.IVATotal) ?? undefined,
      discountCode: this.readString(monthlySubscription.discountCode) ?? undefined,
      discountAmount: this.readNumber(monthlySubscription.discountAmount) ?? undefined,
      customer: this.asOptionalRecord(monthlySubscription.customer),
      service: this.asOptionalRecord(monthlySubscription.service),
      validationDetail: this.asOptionalRecord(monthlySubscription.validationDetail),
      validationResponse: monthlySubscription.validationResponse,
      validationError: this.readString(monthlySubscription.validationError) ?? undefined,
      validatedAt: this.readString(monthlySubscription.validatedAt) ?? undefined,
    };
  }

  private assertMonthlySubscriptionReadyForCollection(
    session: PaymentSessionEntity,
  ): void {
    const monthlySubscription = this.extractMonthlySubscriptionFromMetadata(
      session.metadataJson,
    );
    if (!monthlySubscription) {
      return;
    }

    if (
      monthlySubscription.validated !== true ||
      !session.vehiclePlate ||
      session.targetAmount <= 0
    ) {
      throw new PaymentSessionConflictError(
        'Valide la placa de la mensualidad antes de habilitar el cobro',
      );
    }
  }

  private resolveMonthlyIdentificationFromCode(
    code: string | null | undefined,
  ): MonthlyIdentification | null {
    if (!code) {
      return null;
    }

    const scannedCode = code.trim().replace(/\s+/g, '');
    if (!/^\d+$/.test(scannedCode)) {
      return null;
    }

    if (scannedCode.length === 8) {
      return {
        scannedCode,
        identificationCode: `${scannedCode}00`,
        paddedFromEightDigits: true,
      };
    }

    if (scannedCode.length === 10) {
      return {
        scannedCode,
        identificationCode: scannedCode,
        paddedFromEightDigits: false,
      };
    }

    return null;
  }

  private normalizeMonthlyPlate(value: string): string {
    return value.trim().toUpperCase().replace(/\s+/g, '');
  }

  private resolveVehicleKindFromPlate(plate: string): 'CARRO' | 'MOTO' | null {
    if (/^[A-Z]{3}[0-9]{3}$/.test(plate)) {
      return 'CARRO';
    }

    if (/^[A-Z]{3}[0-9]{2}[A-Z]$/.test(plate) || /^[A-Z]{3}[0-9]{2}$/.test(plate)) {
      return 'MOTO';
    }

    return null;
  }

  private evaluateMonthlyValidationResponse(response: unknown): {
    accepted: boolean;
    reason: string;
    total: number;
    subtotal: number;
    IVAPercentage: number;
    IVATotal: number;
    discountAmount: number;
    discountCode: string;
    plate: string | null;
    vehicleKind: string | null;
    concept: string | null;
    validationDetail: Record<string, unknown>;
  } {
    const responseRecord = this.asRecord(response);
    const validationDetail = this.asRecord(responseRecord.validationDetail);
    const reason =
      this.readString(responseRecord.messageBody) ??
      this.readString(responseRecord.messageTitle) ??
      'nexo_back rechazo la validacion de la mensualidad';
    const total = this.readNumber(responseRecord.total) ?? 0;
    const accepted = responseRecord.isSuccess === true && total > 0;

    return {
      accepted,
      reason: accepted ? 'Mensualidad validada' : reason,
      total,
      subtotal: this.readNumber(responseRecord.subtotal) ?? total,
      IVAPercentage: this.readNumber(responseRecord.IVAPercentage) ?? 0,
      IVATotal: this.readNumber(responseRecord.IVATotal) ?? 0,
      discountAmount: this.readNumber(responseRecord.discountAmount) ?? 0,
      discountCode: this.readString(responseRecord.discountCode) ?? '',
      plate: this.readString(responseRecord.plate),
      vehicleKind: this.readString(responseRecord.vehicleKind),
      concept: this.readString(responseRecord.concept),
      validationDetail,
    };
  }

  private buildMonthlySubscriptionGeneratePayload(
    session: PaymentSessionEntity,
    monthlySubscription: MonthlySubscriptionMetadata,
    committedBy: string,
  ): GenerateMonthlySubscriptionDto {
    const validationDetail = monthlySubscription.validationDetail ?? {};
    const monthlySubscriptionStartDatetime = this.readString(
      validationDetail.requestedMonthlySubscriptionStartDatetime,
    );
    const monthlySubscriptionEndDatetime = this.readString(
      validationDetail.requestedMonthlySubscriptionEndDatetime,
    );

    if (!monthlySubscriptionStartDatetime || !monthlySubscriptionEndDatetime) {
      throw new Error(
        'La mensualidad validada no tiene fechas de inicio y fin para generar el pago',
      );
    }

    const customer = monthlySubscription.customer ?? {};
    return {
      identificationType: 'CC',
      identificationCode:
        monthlySubscription.identificationCode || session.identificationCode || '',
      plate: monthlySubscription.plate || session.vehiclePlate || '',
      vehicleKind: monthlySubscription.vehicleKind || session.vehicleType || 'CARRO',
      discountCode: monthlySubscription.discountCode ?? '',
      datetime: new Date().toISOString(),
      cashier: committedBy?.trim() || 'PPE',
      concept: monthlySubscription.concept || session.concept || 'Mensualidad',
      grossTotal: monthlySubscription.subtotal ?? session.targetAmount,
      subtotal: monthlySubscription.subtotal ?? session.targetAmount,
      IVAPercentage: monthlySubscription.IVAPercentage ?? 0,
      IVATotal: monthlySubscription.IVATotal ?? 0,
      total: session.targetAmount,
      discountAmount: monthlySubscription.discountAmount ?? 0,
      monthlySubscriptionStartDatetime,
      monthlySubscriptionEndDatetime,
      extraServices: [],
      generationDetail: {
        cashValue: session.insertedAmount,
        returnValue: session.changeAmount,
        cashDetail: 'pago mensualidad',
        billsEntered: 0,
        coinsEntered: 0,
        zoneId: this.readNumber(customer.schedulingZoneId) ?? undefined,
      },
    };
  }

  private extractElectronicBillingFromMetadata(
    metadataRaw: string | null,
  ): { enabled: boolean; customerIdentificationNumber: string | null } {
    if (!this.isElectronicBillingEnabled()) {
      return { enabled: false, customerIdentificationNumber: null };
    }

    if (!metadataRaw) {
      return { enabled: false, customerIdentificationNumber: null };
    }

    try {
      const metadata = JSON.parse(metadataRaw) as {
        electronicBilling?: {
          enabled?: unknown;
          customerIdentificationNumber?: unknown;
        };
      };
      const billing = metadata.electronicBilling;
      const customerIdentificationNumber =
        typeof billing?.customerIdentificationNumber === 'string' &&
        billing.customerIdentificationNumber.trim().length > 0
          ? billing.customerIdentificationNumber.trim()
          : null;

      return {
        enabled: billing?.enabled === true && customerIdentificationNumber !== null,
        customerIdentificationNumber,
      };
    } catch {
      return { enabled: false, customerIdentificationNumber: null };
    }
  }

  private isElectronicBillingEnabled() {
    return this.configService.get<boolean>('features.electronicBillingEnabled', false);
  }

  private isMonthlySubscriptionsEnabled() {
    return this.configService.get<boolean>('features.monthlySubscriptionsEnabled', false);
  }

  private parseMetadata(metadataRaw: string | null): Record<string, unknown> {
    if (!metadataRaw) {
      return {};
    }

    try {
      const parsed = JSON.parse(metadataRaw) as unknown;
      return this.asRecord(parsed);
    } catch {
      return {};
    }
  }

  private asRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  }

  private asOptionalRecord(value: unknown): Record<string, unknown> | undefined {
    const record = this.asRecord(value);
    return Object.keys(record).length > 0 ? record : undefined;
  }

  private readString(value: unknown): string | null {
    return typeof value === 'string' && value.trim().length > 0
      ? value
      : null;
  }

  private readNumber(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }

    if (typeof value === 'string' && value.trim().length > 0) {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : null;
    }

    return null;
  }

  private mergeMetadata(
    existingRaw: string | null,
    patch: Record<string, unknown>,
  ): string {
    let existing: Record<string, unknown> = {};

    if (existingRaw) {
      try {
        const parsed = JSON.parse(existingRaw) as Record<string, unknown>;
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          existing = parsed;
        }
      } catch {
        existing = {};
      }
    }

    return JSON.stringify({
      ...existing,
      ...patch,
    });
  }

  private async validateCandidateForSession(
    sessionId: string,
    payload: {
      ppeTransactionUuid: string;
      qrCode: string | null;
      vehiclePlate: string | null;
    },
  ): Promise<{ response: unknown; status: ServerSyncAttemptStatus }> {
    let validationResponse: unknown = null;
    let validationStatus = ServerSyncAttemptStatus.Success;

    await this.paymentSessionRepository.update(sessionId, {
      status: PaymentSessionStatus.Validating,
    });

    try {
      validationResponse = await this.serverLinkService.validatePaymentCandidate(payload);
    } catch (error) {
      validationStatus = ServerSyncAttemptStatus.Failed;
      validationResponse = {
        status: 'SERVER_ERROR',
        accepted: false,
        payable: false,
        error: error instanceof Error ? error.message : 'Error desconocido',
      };
    }

    await this.syncAttemptRepository.save(
      this.syncAttemptRepository.create({
        paymentSessionId: sessionId,
        requestType: ServerSyncAttemptType.Validate,
        requestJson: JSON.stringify(payload),
        responseJson: validationResponse ? JSON.stringify(validationResponse) : null,
        status: validationStatus,
      }),
    );

    return {
      response: validationResponse,
      status: validationStatus,
    };
  }
}
