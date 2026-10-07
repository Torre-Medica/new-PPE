import { PaymentSessionService } from '@modules/payment-core/application/payment-session.service';
import { CashDenominationRejectedError } from '@modules/payment-core/domain/errors/cash-denomination-rejected.error';
import { InsufficientChangeError } from '@modules/payment-core/domain/errors/insufficient-change.error';
import { PaymentSessionConflictError } from '@modules/payment-core/domain/errors/payment-session-conflict.error';
import { PaymentSessionNotFoundError } from '@modules/payment-core/domain/errors/payment-session-not-found.error';
import {
  PaymentSessionEntity,
  PaymentSessionStatus,
  ServerSyncStatus,
} from '@modules/persistence/infrastructure/entities/payment-session.entity';
import {
  ServerSyncAttemptStatus,
  ServerSyncAttemptType,
} from '@modules/persistence/infrastructure/entities/server-sync-attempt.entity';

describe('PaymentSessionService', () => {
  beforeEach(() => {
    jest.useFakeTimers({ doNotFake: ['setImmediate'] });
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  const createRepositoryMock = () => ({
    findOne: jest.fn(),
    findOneByOrFail: jest.fn(),
    find: jest.fn(),
    save: jest.fn(),
    create: jest.fn((value) => value),
    update: jest.fn().mockResolvedValue({ affected: 1 }),
  });

  const createService = () => {
    const paymentSessionRepository = createRepositoryMock();
    const paymentSessionEventRepository = createRepositoryMock();
    const paymentLineRepository = createRepositoryMock();
    const syncAttemptRepository = createRepositoryMock();
    const dataSource = {
      transaction: jest.fn(),
    };

    const cashChangeService = {
      planChange: jest.fn(),
    };
    const cashInventoryService = {
      recordAcceptedCash: jest.fn(),
      recordAcceptedCashWithManager: jest.fn(),
      recordDispensedCash: jest.fn(),
      getAcceptancePolicy: jest.fn().mockResolvedValue({
        acceptedBillDenominations: [1000, 2000, 5000],
        maxAcceptedBill: 5000,
        changeAvailable: 10000,
      }),
      recordCashIncident: jest.fn(),
      getSmallestDispensableDenomination: jest.fn().mockResolvedValue(100),
    };
    const kioskEventsService = {
      emit: jest.fn(),
    };
    const kioskStateService = {
      assertPaymentAvailability: jest.fn().mockResolvedValue({
        allowed: true,
        reason: null,
      }),
      setPaymentsBlocked: jest.fn(),
    };
    const peripheralsService = {
      onMoneyReceived: jest.fn(),
      onQrScanned: jest.fn(),
      connectAll: jest.fn(),
      activateAcceptance: jest.fn(),
      deactivateAcceptance: jest.fn(),
      returnChange: jest.fn().mockResolvedValue([]),
      returnChangeConfirmed: jest.fn().mockResolvedValue({
        confirmed: true,
        timedOut: false,
        total: 0,
        frameBytes: [0, 0, 0, 0],
        commandHex: '',
      }),
      decrementSlotQuantity: jest.fn(),
      getDispenserSlotConfig: jest.fn().mockResolvedValue({
        bill1: 1000,
        bill2: null,
        coin1: 500,
        coin2: null,
      }),
      getDispenserSlots: jest.fn().mockResolvedValue([]),
    };
    const serverLinkService = {
      validatePaymentCandidate: jest.fn(),
      commitPayment: jest.fn(),
      cancelPayment: jest.fn(),
      getConnectionStatus: jest.fn(),
    };

    const nexoBackRestService = {
      syncPaymentPointCash: jest.fn().mockResolvedValue(undefined),
    };

    const configService = {
      get: jest.fn((_key: string, defaultValue?: unknown) => defaultValue),
    };

    const service = new PaymentSessionService(
      paymentSessionRepository as never,
      paymentSessionEventRepository as never,
      paymentLineRepository as never,
      syncAttemptRepository as never,
      dataSource as never,
      cashChangeService as never,
      cashInventoryService as never,
      kioskEventsService as never,
      kioskStateService as never,
      peripheralsService as never,
      serverLinkService as never,
      nexoBackRestService as never,
      configService as never,
    );

    return {
      service,
      paymentSessionRepository,
      paymentSessionEventRepository,
      syncAttemptRepository,
      cashChangeService,
      cashInventoryService,
      kioskEventsService,
      kioskStateService,
      peripheralsService,
      serverLinkService,
      nexoBackRestService,
      dataSource,
    };
  };

  const makeSession = (overrides: Partial<PaymentSessionEntity> = {}): PaymentSessionEntity => ({
    id: 'session-1',
    serverProcessId: 77,
    serverPaymentId: null,
    serverSyncStatus: ServerSyncStatus.Pending,
    qrCode: 'qr-1',
    vehiclePlate: 'ABC123',
    vehicleType: null,
    identificationType: null,
    identificationCode: null,
    concept: 'Parqueadero',
    targetAmount: 5000,
    insertedAmount: 5000,
    changeAmount: 0,
    status: PaymentSessionStatus.ReadyToCommit,
    startedAt: new Date('2026-05-12T10:00:00.000Z'),
    completedAt: null,
    failureReason: null,
    metadataJson: null,
    createdAt: new Date('2026-05-12T10:00:00.000Z'),
    updatedAt: new Date('2026-05-12T10:00:00.000Z'),
    paymentLines: [],
    events: [],
    syncAttempts: [],
    cashMovements: [],
    ...overrides,
  });

  // ── Fase 10: pago exacto ──────────────────────────────────────────────────

  it('completes an exact-cash session and confirms it with the server', async () => {
    const {
      service,
      paymentSessionRepository,
      paymentSessionEventRepository,
      syncAttemptRepository,
      peripheralsService,
      serverLinkService,
    } = createService();

    const session = makeSession({
      metadataJson: JSON.stringify({
        validation: {
          expectedOutcomeDatetime: '2026-05-12T11:00:00.000Z',
        },
      }),
    });
    const finalSession = makeSession({
      status: PaymentSessionStatus.Completed,
      serverSyncStatus: ServerSyncStatus.Confirmed,
      serverPaymentId: 901,
      completedAt: new Date('2026-05-12T10:05:00.000Z'),
    });

    paymentSessionRepository.findOne
      .mockResolvedValueOnce(session)
      .mockResolvedValueOnce(finalSession);
    serverLinkService.commitPayment.mockResolvedValue({
      paymentRegistered: true,
      serverPaymentId: 901,
      paidDatetime: '2026-05-12T10:05:00.000Z',
      exitUntil: '2026-05-13T10:00:00.000Z',
      allowedToExit: true,
    });

    const result = await service.completeSession('session-1', { committedBy: 'unit-test' });

    expect(serverLinkService.commitPayment).toHaveBeenCalledWith({
      ppeTransactionUuid: 'session-1',
      processId: 77,
      qrCode: 'qr-1',
      vehiclePlate: 'ABC123',
      targetAmount: 5000,
      insertedAmount: 5000,
      changeAmount: 0,
      expectedOutcomeDatetime: '2026-05-12T11:00:00.000Z',
      committedBy: 'unit-test',
    });
    expect(syncAttemptRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        paymentSessionId: 'session-1',
        requestType: ServerSyncAttemptType.Commit,
        status: ServerSyncAttemptStatus.Success,
      }),
    );
    expect(paymentSessionRepository.update).toHaveBeenNthCalledWith(1, 'session-1', {
      status: PaymentSessionStatus.CommittingToServer,
    });
    expect(paymentSessionRepository.update).toHaveBeenNthCalledWith(2, 'session-1', {
      status: PaymentSessionStatus.Completed,
      serverSyncStatus: ServerSyncStatus.Confirmed,
      serverPaymentId: 901,
      completedAt: expect.any(Date),
      failureReason: null,
      metadataJson: expect.stringContaining('"exitUntil":"2026-05-13T10:00:00.000Z"'),
    });
    expect(peripheralsService.deactivateAcceptance).toHaveBeenCalled();
    expect(paymentSessionEventRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        paymentSessionId: 'session-1',
        type: 'payment.session.completed',
      }),
    );
    expect(result.status).toBe(PaymentSessionStatus.Completed);
    expect(result.serverPaymentId).toBe(901);
  });

  // ── Fase 10: pago con sobrante y devolución correcta ─────────────────────

  it('dispenses change and commits when inserted amount exceeds target', async () => {
    const {
      service,
      paymentSessionRepository,
      paymentSessionEventRepository,
      cashChangeService,
      cashInventoryService,
      peripheralsService,
      serverLinkService,
      kioskEventsService,
    } = createService();

    const session = makeSession({
      targetAmount: 4000,
      insertedAmount: 5000,
      changeAmount: 1000,
      status: PaymentSessionStatus.ChangePending,
    });
    const finalSession = makeSession({
      targetAmount: 4000,
      insertedAmount: 5000,
      changeAmount: 1000,
      status: PaymentSessionStatus.Completed,
      serverSyncStatus: ServerSyncStatus.Confirmed,
      serverPaymentId: 902,
      completedAt: new Date(),
    });

    paymentSessionRepository.findOne
      .mockResolvedValueOnce(session)
      .mockResolvedValueOnce(finalSession);
    cashChangeService.planChange.mockResolvedValue({
      remaining: 0,
      items: [{ denominationId: 1000, quantity: 1 }],
    });
    peripheralsService.returnChange.mockResolvedValue([
      {
        slotKey: 'bill1',
        requestedDenomination: 1000,
        quantity: 1,
        frameBytes: [1, 0, 0, 0],
        controlUnitValue: 1000,
        rawTotal: 1000,
        commandBytes: [],
        commandHex: '',
      },
    ]);
    serverLinkService.commitPayment.mockResolvedValue({
      paymentRegistered: true,
      serverPaymentId: 902,
    });

    const result = await service.completeSession('session-1', { committedBy: 'unit-test' });

    expect(cashChangeService.planChange).toHaveBeenCalledWith(1000, expect.any(Set));
    expect(peripheralsService.returnChange).toHaveBeenCalledWith([
      { slotKey: 'bill1', denomination: 1000, quantity: 1 },
    ]);
    expect(paymentSessionEventRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'payment.change.dispensed' }),
    );
    expect(result.status).toBe(PaymentSessionStatus.Completed);
    expect(kioskEventsService.emit).toHaveBeenCalledWith(
      'session.completed',
      expect.objectContaining({
        status: PaymentSessionStatus.Completed,
        paymentRegistered: true,
      }),
    );
  });

  // ── Fase 10: error de inventario insuficiente para cambio ─────────────────

  it('throws InsufficientChangeError when inventory cannot cover change', async () => {
    const { service, paymentSessionRepository, cashChangeService } = createService();

    const session = makeSession({
      targetAmount: 4000,
      insertedAmount: 5000,
      changeAmount: 1000,
      status: PaymentSessionStatus.ChangePending,
    });

    paymentSessionRepository.findOne.mockResolvedValue(session);
    cashChangeService.planChange.mockResolvedValue({
      remaining: 500,
      items: [{ denominationId: 500, quantity: 1 }],
    });

    await expect(
      service.completeSession('session-1', { committedBy: 'unit-test' }),
    ).rejects.toBeInstanceOf(InsufficientChangeError);
  });

  it('completes the session and records a novedad when the remaining change is below the smallest dispensable denomination', async () => {
    const {
      service,
      paymentSessionRepository,
      cashChangeService,
      cashInventoryService,
      serverLinkService,
    } = createService();

    const session = makeSession({
      targetAmount: 2800,
      insertedAmount: 2850,
      changeAmount: 50,
      status: PaymentSessionStatus.ChangePending,
    });
    const finalSession = makeSession({
      targetAmount: 2800,
      insertedAmount: 2850,
      changeAmount: 50,
      status: PaymentSessionStatus.Completed,
      serverSyncStatus: ServerSyncStatus.Confirmed,
      serverPaymentId: 903,
      completedAt: new Date(),
    });

    paymentSessionRepository.findOne
      .mockResolvedValueOnce(session)
      .mockResolvedValueOnce(finalSession);
    cashChangeService.planChange.mockResolvedValue({
      remaining: 50,
      items: [],
    });
    cashInventoryService.getSmallestDispensableDenomination.mockResolvedValue(100);
    serverLinkService.commitPayment.mockResolvedValue({
      paymentRegistered: true,
      serverPaymentId: 903,
    });

    const result = await service.completeSession('session-1', { committedBy: 'unit-test' });

    expect(cashInventoryService.recordCashIncident).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'UNDISPENSABLE_CHANGE',
        amount: 50,
        paymentSessionId: 'session-1',
      }),
    );
    expect(result.status).toBe(PaymentSessionStatus.Completed);
  });

  it('still throws InsufficientChangeError when there are no active dispenser slots at all, instead of writing off the remainder', async () => {
    const { service, paymentSessionRepository, cashChangeService, cashInventoryService } = createService();

    const session = makeSession({
      targetAmount: 2800,
      insertedAmount: 2850,
      changeAmount: 50,
      status: PaymentSessionStatus.ChangePending,
    });

    paymentSessionRepository.findOne.mockResolvedValue(session);
    cashChangeService.planChange.mockResolvedValue({
      remaining: 50,
      items: [],
    });
    // Sin tolvas activas configuradas: getSmallestDispensableDenomination = Infinity
    cashInventoryService.getSmallestDispensableDenomination.mockResolvedValue(Infinity);

    await expect(
      service.completeSession('session-1', { committedBy: 'unit-test' }),
    ).rejects.toBeInstanceOf(InsufficientChangeError);

    expect(cashInventoryService.recordCashIncident).not.toHaveBeenCalled();
  });

  // ── Fase 10: cancelación correcta ────────────────────────────────────────

  it('cancels an active session and notifies the server', async () => {
    const {
      service,
      paymentSessionRepository,
      paymentSessionEventRepository,
      syncAttemptRepository,
      peripheralsService,
      serverLinkService,
    } = createService();

    const session = makeSession({ status: PaymentSessionStatus.ListeningCash });
    const canceledSession = makeSession({
      status: PaymentSessionStatus.Canceled,
      completedAt: new Date(),
    });

    paymentSessionRepository.findOne
      .mockResolvedValueOnce(session)    // getSessionById inside cancelSession
      .mockResolvedValueOnce(canceledSession); // getSessionById at end
    serverLinkService.cancelPayment.mockResolvedValue({ canceled: true, acknowledged: true });

    const result = await service.cancelSession('session-1');

    expect(paymentSessionRepository.update).toHaveBeenCalledWith(
      { id: 'session-1', status: PaymentSessionStatus.ListeningCash },
      {
        status: PaymentSessionStatus.Canceled,
        completedAt: expect.any(Date),
        failureReason: 'Cancelada manualmente',
      },
    );
    expect(peripheralsService.deactivateAcceptance).toHaveBeenCalled();
    expect(serverLinkService.cancelPayment).toHaveBeenCalledWith(
      expect.objectContaining({ ppeTransactionUuid: 'session-1', reason: expect.any(String) }),
    );
    expect(syncAttemptRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({ requestType: ServerSyncAttemptType.Cancel }),
    );
    expect(paymentSessionEventRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'payment.session.canceled' }),
    );
    expect(result.status).toBe(PaymentSessionStatus.Canceled);
  });

  // ── Fase 10: cancelación rechazada por estado inválido ───────────────────

  it('throws PaymentSessionConflictError when canceling a non-active session', async () => {
    const { service, paymentSessionRepository } = createService();

    paymentSessionRepository.findOne.mockResolvedValue(
      makeSession({ status: PaymentSessionStatus.Completed }),
    );

    await expect(service.cancelSession('session-1')).rejects.toBeInstanceOf(
      PaymentSessionConflictError,
    );
  });

  it('does not refund twice when two cancel calls race on the same session (conditional update loses)', async () => {
    const { service, paymentSessionRepository, peripheralsService } = createService();

    paymentSessionRepository.findOne.mockResolvedValue(
      makeSession({ status: PaymentSessionStatus.ListeningCash, insertedAmount: 5000 }),
    );
    // Simula que otra operacion concurrente (otra cancelacion, o el watcher de
    // timeout) ya modifico la sesion primero: el UPDATE condicionado no afecta
    // ninguna fila.
    paymentSessionRepository.update.mockResolvedValue({ affected: 0 });

    await expect(service.cancelSession('session-1')).rejects.toBeInstanceOf(
      PaymentSessionConflictError,
    );
    expect(peripheralsService.returnChangeConfirmed).not.toHaveBeenCalled();
  });

  it('refunds inserted cash with one full frame (hardware-confirmed) when canceling', async () => {
    const {
      service,
      paymentSessionRepository,
      paymentSessionEventRepository,
      cashChangeService,
      peripheralsService,
      kioskEventsService,
    } = createService();

    const session = makeSession({
      status: PaymentSessionStatus.ListeningCash,
      insertedAmount: 5000,
    });
    const canceledSession = makeSession({
      status: PaymentSessionStatus.Canceled,
      insertedAmount: 5000,
      completedAt: new Date(),
    });

    paymentSessionRepository.findOne
      .mockResolvedValueOnce(session)
      .mockResolvedValueOnce(canceledSession);
    cashChangeService.planChange.mockResolvedValue({
      remaining: 0,
      items: [{ denominationId: 1000, quantity: 5 }],
    });
    peripheralsService.returnChangeConfirmed.mockResolvedValue({
      confirmed: true,
      timedOut: false,
      total: 5000,
      frameBytes: [1, 0, 0, 0],
      commandHex: '',
    });

    await service.cancelSession('session-1');

    expect(peripheralsService.returnChangeConfirmed).toHaveBeenCalledWith([
      { slotKey: 'bill1', denomination: 1000, quantity: 5 },
    ]);
    expect(peripheralsService.returnChange).not.toHaveBeenCalled();
    expect(kioskEventsService.emit).not.toHaveBeenCalledWith(
      'machine.refund-alert',
      expect.anything(),
    );
    expect(paymentSessionEventRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'payment.refunded' }),
    );
  });

  it('alerts the operator when the board does not confirm dispensing a cancel refund', async () => {
    const {
      service,
      paymentSessionRepository,
      paymentSessionEventRepository,
      cashChangeService,
      peripheralsService,
      kioskEventsService,
    } = createService();

    const session = makeSession({
      status: PaymentSessionStatus.ListeningCash,
      insertedAmount: 5000,
    });
    const canceledSession = makeSession({
      status: PaymentSessionStatus.Canceled,
      insertedAmount: 5000,
      completedAt: new Date(),
    });

    paymentSessionRepository.findOne
      .mockResolvedValueOnce(session)
      .mockResolvedValueOnce(canceledSession);
    cashChangeService.planChange.mockResolvedValue({
      remaining: 0,
      items: [{ denominationId: 1000, quantity: 5 }],
    });
    peripheralsService.returnChangeConfirmed.mockResolvedValue({
      confirmed: false,
      timedOut: true,
      total: 5000,
      frameBytes: [1, 0, 0, 0],
      commandHex: '',
    });

    await service.cancelSession('session-1');

    expect(kioskEventsService.emit).toHaveBeenCalledWith(
      'machine.refund-alert',
      expect.objectContaining({ paymentSessionId: 'session-1', insertedAmount: 5000 }),
    );
    expect(paymentSessionEventRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'payment.refund-unconfirmed' }),
    );
  });

  // ── Fase 10: error de servidor en commit → CompletedWithWarning ───────────

  it('marks session as CompletedWithWarning when server rejects commit', async () => {
    const {
      service,
      paymentSessionRepository,
      syncAttemptRepository,
      serverLinkService,
      kioskEventsService,
    } = createService();

    const session = makeSession();
    const warningSession = makeSession({
      status: PaymentSessionStatus.CompletedWithWarning,
      serverSyncStatus: ServerSyncStatus.Rejected,
      serverPaymentId: null,
      failureReason: 'El servidor principal no confirmo el pago',
      completedAt: new Date(),
    });

    paymentSessionRepository.findOne
      .mockResolvedValueOnce(session)
      .mockResolvedValueOnce(warningSession);
    serverLinkService.commitPayment.mockResolvedValue({ paymentRegistered: false });

    const result = await service.completeSession('session-1', { committedBy: 'unit-test' });

    expect(paymentSessionRepository.update).toHaveBeenCalledWith('session-1',
      expect.objectContaining({ status: PaymentSessionStatus.CompletedWithWarning }),
    );
    expect(syncAttemptRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({ status: ServerSyncAttemptStatus.Success }),
    );
    expect(result.status).toBe(PaymentSessionStatus.CompletedWithWarning);
    expect(result.serverPaymentId).toBeNull();
    // El frontend NO debe mostrar "puede retirar su vehiculo" si el servidor
    // central (quien controla la salida) nunca confirmo el pago.
    expect(kioskEventsService.emit).toHaveBeenCalledWith(
      'session.completed',
      expect.objectContaining({
        status: PaymentSessionStatus.CompletedWithWarning,
        paymentRegistered: false,
      }),
    );
  });

  // ── Fase 10: sesión no encontrada ────────────────────────────────────────

  it('throws PaymentSessionNotFoundError for an unknown session id', async () => {
    const { service, paymentSessionRepository } = createService();

    paymentSessionRepository.findOne.mockResolvedValue(null);

    await expect(service.getSessionById('unknown-id')).rejects.toBeInstanceOf(
      PaymentSessionNotFoundError,
    );
  });

  // ── Fase 10: sesión duplicada activa ─────────────────────────────────────

  it('throws PaymentSessionConflictError when an active session already exists', async () => {
    const { service, paymentSessionRepository } = createService();

    paymentSessionRepository.findOne.mockResolvedValue(
      makeSession({ status: PaymentSessionStatus.ListeningCash }),
    );

    await expect(
      service.startSession({ targetAmount: 3000 }),
    ).rejects.toBeInstanceOf(PaymentSessionConflictError);
  });

  it('blocks a new session when the previous one ended with a rejected server commit', async () => {
    const { service, paymentSessionRepository } = createService();

    const priorSession = makeSession({
      status: PaymentSessionStatus.CompletedWithWarning,
      serverSyncStatus: ServerSyncStatus.Rejected,
      serverPaymentId: null,
      failureReason: 'El servidor principal no confirmo el pago',
    });

    paymentSessionRepository.findOne.mockImplementation(async (options) => {
      const where = options?.where as Array<Record<string, unknown>> | undefined;
      const statuses = where?.flatMap((condition) => {
        const status = condition.status;
        return Array.isArray(status) ? status : [status];
      }) ?? [];

      if (
        statuses.includes(PaymentSessionStatus.CommittingToServer) ||
        statuses.includes(PaymentSessionStatus.CompletedWithWarning)
      ) {
        return priorSession;
      }

      return null;
    });
    paymentSessionRepository.save.mockImplementation(async (value) => value);

    await expect(
      service.startSession({ targetAmount: 3000 }),
    ).rejects.toBeInstanceOf(PaymentSessionConflictError);
  });

  // ── Fase 10: reintentos pendientes sin re-dispensar cambio ───────────────

  it('subscribes to QR scanned events on bootstrap', () => {
    const { service, peripheralsService } = createService();

    service.onApplicationBootstrap();

    expect(peripheralsService.onQrScanned).toHaveBeenCalled();
  });

  it('creates a payable session from a scanned QR when the server returns pending payment', async () => {
    const {
      service,
      paymentSessionRepository,
      paymentSessionEventRepository,
      syncAttemptRepository,
      peripheralsService,
      serverLinkService,
    } = createService();

    let qrHandler: ((event: Record<string, unknown>) => void) | undefined;
    peripheralsService.onQrScanned.mockImplementation((handler: typeof qrHandler) => {
      qrHandler = handler;
    });

    const reviewedQrSession = {
      ...makeSession({
        id: 'qr-session-1',
        serverProcessId: 456,
        qrCode: 'qr-live-001',
        vehiclePlate: 'XYZ987',
        vehicleType: 'CAR',
        targetAmount: 8500,
        status: PaymentSessionStatus.Validated,
        concept: 'Pago parqueadero',
      }),
      identificationCode: 'qr-live-001',
    };

    paymentSessionRepository.findOne
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(reviewedQrSession)
      .mockResolvedValue(reviewedQrSession);
    paymentSessionRepository.create.mockImplementation((value) => value);
    paymentSessionRepository.save.mockImplementation(async (value) => ({
      id: 'qr-session-1',
      ...value,
    }));
    serverLinkService.validatePaymentCandidate.mockResolvedValue({
      status: 'PENDING_PAYMENT',
      processId: 456,
      total: 8500,
      incomeConditionType: 'Visitor',
      concept: 'Pago parqueadero',
      vehiclePlate: 'XYZ987',
      vehicleType: 'CAR',
      startDatetime: '2026-05-13T18:00:00.000Z',
      validationDetail: {
        expectedOutcomeDatetime: '2026-05-13T20:00:00.000Z',
      },
      paidStatus: false,
    });

    service.onApplicationBootstrap();
    await qrHandler?.({
      source: 'QR_SCANNER',
      qrCode: 'qr-live-001',
      rawCode: 'qr-live-001',
      port: 'COM4',
      scannedAt: '2026-05-13T18:00:00.000Z',
    });
    await new Promise((resolve) => setImmediate(resolve));

    expect(serverLinkService.validatePaymentCandidate).toHaveBeenCalledWith({
      ppeTransactionUuid: 'qr-session-1',
      qrCode: 'qr-live-001',
      vehiclePlate: null,
    });
    expect(syncAttemptRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        paymentSessionId: 'qr-session-1',
        requestType: ServerSyncAttemptType.Validate,
        status: ServerSyncAttemptStatus.Success,
      }),
    );
    expect(paymentSessionRepository.update).toHaveBeenCalledWith(
      'qr-session-1',
      expect.objectContaining({
        serverProcessId: 456,
        targetAmount: 8500,
        status: PaymentSessionStatus.Validated,
        metadataJson: expect.stringContaining(
          '"expectedOutcomeDatetime":"2026-05-13T20:00:00.000Z"',
        ),
      }),
    );
    expect(peripheralsService.connectAll).not.toHaveBeenCalled();
    expect(peripheralsService.activateAcceptance).not.toHaveBeenCalled();
    expect(paymentSessionEventRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        paymentSessionId: 'qr-session-1',
        type: 'payment.qr.accepted',
      }),
    );
  });

  it('marks scanned QR session as failed when the server reports it as already paid', async () => {
    const {
      service,
      paymentSessionRepository,
      paymentSessionEventRepository,
      peripheralsService,
      serverLinkService,
    } = createService();

    let qrHandler: ((event: Record<string, unknown>) => void) | undefined;
    peripheralsService.onQrScanned.mockImplementation((handler: typeof qrHandler) => {
      qrHandler = handler;
    });

    paymentSessionRepository.findOne.mockResolvedValue(null);
    paymentSessionRepository.create.mockImplementation((value) => value);
    paymentSessionRepository.save.mockImplementation(async (value) => ({
      id: 'qr-session-2',
      ...value,
    }));
    serverLinkService.validatePaymentCandidate.mockResolvedValue({
      status: 'ALREADY_PAID',
      paidStatus: true,
    });

    service.onApplicationBootstrap();
    await qrHandler?.({
      source: 'QR_SCANNER',
      qrCode: 'qr-paid-001',
      rawCode: 'qr-paid-001',
      port: 'COM4',
      scannedAt: '2026-05-13T18:05:00.000Z',
    });
    await new Promise((resolve) => setImmediate(resolve));

    expect(paymentSessionRepository.update).toHaveBeenCalledWith(
      'qr-session-2',
      expect.objectContaining({
        status: PaymentSessionStatus.Failed,
        failureReason: 'Tiquete ya pagado, no requiere pago adicional',
      }),
    );
    expect(peripheralsService.connectAll).not.toHaveBeenCalled();
    expect(paymentSessionEventRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        paymentSessionId: 'qr-session-2',
        type: 'payment.qr.already-paid',
      }),
    );
  });

  it('retries a pending server commit without dispensing change again', async () => {
    const {
      service,
      paymentSessionRepository,
      paymentSessionEventRepository,
      syncAttemptRepository,
      peripheralsService,
      serverLinkService,
    } = createService();

    const retryCandidate = makeSession({
      id: 'session-2',
      serverProcessId: 88,
      serverSyncStatus: ServerSyncStatus.Rejected,
      qrCode: 'qr-2',
      vehiclePlate: null,
      targetAmount: 4000,
      insertedAmount: 5000,
      changeAmount: 1000,
      status: PaymentSessionStatus.CompletedWithWarning,
      completedAt: new Date('2026-05-12T11:03:00.000Z'),
      failureReason: 'El servidor principal no confirmo el pago',
      updatedAt: new Date('2026-05-12T11:03:00.000Z'),
    });

    const finalSession = makeSession({
      ...retryCandidate,
      status: PaymentSessionStatus.Completed,
      serverSyncStatus: ServerSyncStatus.Confirmed,
      serverPaymentId: 902,
      failureReason: null,
    });

    paymentSessionRepository.find.mockResolvedValue([retryCandidate]);
    paymentSessionRepository.findOne.mockResolvedValue(finalSession);
    serverLinkService.commitPayment.mockResolvedValue({
      paymentRegistered: true,
      serverPaymentId: 902,
    });

    const result = await service.retryPendingCommits({ limit: 5 });

    expect(result.attempted).toBe(1);
    expect(result.results).toEqual([
      {
        paymentSessionId: 'session-2',
        status: PaymentSessionStatus.Completed,
        serverPaymentId: 902,
        serverSyncStatus: ServerSyncStatus.Confirmed,
      },
    ]);
    expect(peripheralsService.returnChangeConfirmed).not.toHaveBeenCalled();
    expect(syncAttemptRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        paymentSessionId: 'session-2',
        requestType: ServerSyncAttemptType.Commit,
      }),
    );
    expect(paymentSessionEventRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        paymentSessionId: 'session-2',
        type: 'payment.sync.retry.requested',
      }),
    );
  });

  // ── Reintento automatico de commits pendientes ───────────────────────────

  it('auto-retries a pending commit while still inside the 5-minute window', async () => {
    const { service, paymentSessionRepository, syncAttemptRepository, serverLinkService } =
      createService();

    const retryCandidate = makeSession({
      id: 'session-2',
      serverSyncStatus: ServerSyncStatus.Rejected,
      status: PaymentSessionStatus.CompletedWithWarning,
      insertedAmount: 5000,
      completedAt: new Date(),
      updatedAt: new Date(),
    });

    paymentSessionRepository.find.mockResolvedValue([retryCandidate]);
    paymentSessionRepository.findOne.mockResolvedValue(
      makeSession({ ...retryCandidate, status: PaymentSessionStatus.Completed }),
    );
    // Primer intento hace 1 minuto — dentro de la ventana de 5 minutos.
    syncAttemptRepository.findOne.mockResolvedValue({
      createdAt: new Date(Date.now() - 60_000),
    });
    serverLinkService.commitPayment.mockResolvedValue({
      paymentRegistered: true,
      serverPaymentId: 999,
    });

    await (
      service as unknown as { autoRetryPendingCommits: () => Promise<void> }
    ).autoRetryPendingCommits();

    expect(serverLinkService.commitPayment).toHaveBeenCalled();
  });

  it('stops retrying and alerts the operator once the 5-minute auto-retry window is exceeded', async () => {
    const {
      service,
      paymentSessionRepository,
      paymentSessionEventRepository,
      syncAttemptRepository,
      serverLinkService,
      kioskEventsService,
    } = createService();

    const retryCandidate = makeSession({
      id: 'session-2',
      serverSyncStatus: ServerSyncStatus.Rejected,
      status: PaymentSessionStatus.CompletedWithWarning,
      insertedAmount: 5000,
      completedAt: new Date(),
      updatedAt: new Date(),
    });

    paymentSessionRepository.find.mockResolvedValue([retryCandidate]);
    // Primer intento hace 6 minutos — ya supero la ventana de 5 minutos.
    syncAttemptRepository.findOne.mockResolvedValue({
      createdAt: new Date(Date.now() - 6 * 60_000),
    });
    // No hay evento previo de agotamiento todavia.
    paymentSessionEventRepository.findOne.mockResolvedValue(null);

    await (
      service as unknown as { autoRetryPendingCommits: () => Promise<void> }
    ).autoRetryPendingCommits();

    expect(serverLinkService.commitPayment).not.toHaveBeenCalled();
    expect(paymentSessionEventRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        paymentSessionId: 'session-2',
        type: 'payment.sync.exhausted',
      }),
    );
    expect(kioskEventsService.emit).toHaveBeenCalledWith(
      'machine.payment-unconfirmed',
      expect.objectContaining({ paymentSessionId: 'session-2' }),
    );
  });

  it('does not alert the operator again once already exhausted', async () => {
    const {
      service,
      paymentSessionRepository,
      paymentSessionEventRepository,
      syncAttemptRepository,
      serverLinkService,
      kioskEventsService,
    } = createService();

    const retryCandidate = makeSession({
      id: 'session-2',
      serverSyncStatus: ServerSyncStatus.Rejected,
      status: PaymentSessionStatus.CompletedWithWarning,
      insertedAmount: 5000,
      completedAt: new Date(),
      updatedAt: new Date(),
    });

    paymentSessionRepository.find.mockResolvedValue([retryCandidate]);
    syncAttemptRepository.findOne.mockResolvedValue({
      createdAt: new Date(Date.now() - 6 * 60_000),
    });
    // Ya se aviso antes.
    paymentSessionEventRepository.findOne.mockResolvedValue({
      type: 'payment.sync.exhausted',
    });

    await (
      service as unknown as { autoRetryPendingCommits: () => Promise<void> }
    ).autoRetryPendingCommits();

    expect(serverLinkService.commitPayment).not.toHaveBeenCalled();
    expect(kioskEventsService.emit).not.toHaveBeenCalledWith(
      'machine.payment-unconfirmed',
      expect.anything(),
    );
  });

  // ── Estado inválido para completar ───────────────────────────────────────

  it('throws PaymentSessionConflictError when completing from an invalid status', async () => {
    const { service, paymentSessionRepository } = createService();

    paymentSessionRepository.findOne.mockResolvedValue(
      makeSession({ status: PaymentSessionStatus.ListeningCash }),
    );

    await expect(
      service.completeSession('session-1', { committedBy: 'unit-test' }),
    ).rejects.toBeInstanceOf(PaymentSessionConflictError);
  });

  // ── Pipeline completo: QR → 2 billetes → cambio → commit ─────────────────

  describe('pipeline completo — QR → efectivo → cambio → commit', () => {
    it('dos billetes de $5k, deuda $8.5k → cambio $1.5k → auto-commit → Completed', async () => {
      const {
        service,
        paymentSessionRepository,
        paymentSessionEventRepository,
        syncAttemptRepository,
        cashChangeService,
        cashInventoryService,
        peripheralsService,
        serverLinkService,
        dataSource,
      } = createService();

      const flushPromises = () => new Promise<void>((r) => setImmediate(r));

      // ── Snapshots de estado que el repo retorna en cada llamada ──────────
      const sessionListening0 = makeSession({
        id: 'pipeline-1',
        serverProcessId: 123,
        serverPaymentId: null,
        serverSyncStatus: ServerSyncStatus.Pending,
        qrCode: 'ticket-001',
        vehiclePlate: 'PPE001',
        vehicleType: 'CAR',
        concept: 'Parqueadero',
        targetAmount: 8500,
        insertedAmount: 0,
        changeAmount: 0,
        status: PaymentSessionStatus.ListeningCash,
      });

      const sessionValidated = {
        ...sessionListening0,
        status: PaymentSessionStatus.Validated,
      };

      const sessionListening5k = {
        ...sessionListening0,
        insertedAmount: 5000,
      };

      const sessionChangePending = {
        ...sessionListening0,
        insertedAmount: 10000,
        changeAmount: 1500,
        status: PaymentSessionStatus.ChangePending,
      };

      const sessionCompleted = {
        ...sessionListening0,
        insertedAmount: 10000,
        changeAmount: 1500,
        status: PaymentSessionStatus.Completed,
        serverSyncStatus: ServerSyncStatus.Confirmed,
        serverPaymentId: 999,
        completedAt: new Date(),
      };

      // ── Captura de handlers ──────────────────────────────────────────────
      let qrHandler: ((event: Record<string, unknown>) => void) | undefined;
      let moneyHandler: ((event: { source: string; amount: number }) => void) | undefined;
      peripheralsService.onQrScanned.mockImplementation((h: typeof qrHandler) => { qrHandler = h; });
      peripheralsService.onMoneyReceived.mockImplementation((h: typeof moneyHandler) => { moneyHandler = h; });

      // ── Repository: save genera el id de sesion ──────────────────────────
      paymentSessionRepository.save.mockImplementation(async (value: Record<string, unknown>) => ({
        id: 'pipeline-1',
        ...value,
      }));

      // findOne:
      // 1. QR — verifica sesion activa → null
      // 2. Billete 1 — handlePeripheralMoneyEvent → listening(0)
      // 3. Billete 1 — registerCash: getSessionById → listening(0)
      // 4. Billete 1 — registerCash: getSessionById (fin) → listening(5k)
      // 5. Billete 2 — handlePeripheralMoneyEvent → listening(5k)
      // 6. Billete 2 — registerCash: getSessionById → listening(5k)
      // 7. Billete 2 — registerCash: getSessionById (fin) → changePending
      // 8. completeSession: getSessionById → changePending
      // 9. commitSessionToServer: getSessionById (fin) → completed
      paymentSessionRepository.findOne
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(sessionValidated)
        .mockResolvedValueOnce(sessionValidated)
        .mockResolvedValueOnce(sessionListening0)
        .mockResolvedValueOnce(sessionListening0)
        .mockResolvedValueOnce(sessionListening0)
        .mockResolvedValueOnce(sessionListening5k)
        .mockResolvedValueOnce(sessionListening5k)
        .mockResolvedValueOnce(sessionListening5k)
        .mockResolvedValueOnce(sessionChangePending)
        .mockResolvedValueOnce(sessionChangePending)
        .mockResolvedValueOnce(sessionCompleted);

      // dataSource.transaction: ejecuta el callback con un manager simulado.
      // Cada llamada arranca desde el estado actual de insertedAmount.
      let txCallCount = 0;
      dataSource.transaction.mockImplementation(
        async (cb: (m: Record<string, unknown>) => Promise<void>) => {
          txCallCount++;
          const base = txCallCount === 1 ? sessionListening0 : sessionListening5k;
          const txSession = { ...base };
          const manager = {
            findOneByOrFail: jest.fn().mockResolvedValue(txSession),
            findOne: jest.fn().mockResolvedValue(null),
            save: jest.fn().mockImplementation(async (_cls: unknown, entity: unknown) => entity),
            create: jest.fn((_cls: unknown, value: unknown) => value),
          };
          await cb(manager);
        },
      );

      // ── Mocks de servicios ───────────────────────────────────────────────
      serverLinkService.validatePaymentCandidate.mockResolvedValue({
        status: 'PENDING_PAYMENT',
        processId: 123,
        total: 8500,
        concept: 'Parqueadero',
        vehiclePlate: 'PPE001',
        vehicleType: 'CAR',
        validationDetail: {
          expectedOutcomeDatetime: '2026-05-14T12:00:00.000Z',
        },
        paidStatus: false,
      });

      // Slot config: bill1=$1.000 activo, coin1=$500 activo; los demás inactivos
      peripheralsService.getDispenserSlotConfig.mockResolvedValue({
        bill1: 1000,
        bill2: null,
        coin1: 500,
        coin2: null,
      });

      cashChangeService.planChange.mockResolvedValue({
        remaining: 0,
        items: [
          { denominationId: 1000, quantity: 1 },
          { denominationId: 500, quantity: 1 },
        ],
      });

      peripheralsService.returnChange.mockResolvedValue([
        {
          slotKey: 'bill1',
          requestedDenomination: 1000,
          quantity: 1,
          frameBytes: [1, 0, 0, 0],
          controlUnitValue: 1000,
          rawTotal: 1500,
          commandBytes: [],
          commandHex: '',
        },
        {
          slotKey: 'coin1',
          requestedDenomination: 500,
          quantity: 1,
          frameBytes: [1, 0, 0, 0],
          controlUnitValue: 500,
          rawTotal: 1500,
          commandBytes: [],
          commandHex: '',
        },
      ]);

      serverLinkService.commitPayment.mockResolvedValue({
        paymentRegistered: true,
        serverPaymentId: 999,
      });

      // ── Ejecutar pipeline ────────────────────────────────────────────────
      service.onApplicationBootstrap();

      // Paso 1: escanear QR
      await qrHandler?.({
        source: 'QR_SCANNER',
        qrCode: 'ticket-001',
        rawCode: 'ticket-001',
        port: 'COM4',
        scannedAt: '2026-05-14T10:00:00.000Z',
      });
      await flushPromises();

      await service.activateCollection('pipeline-1', { initiatedBy: 'test' });

      // Paso 2: primer billete de $5.000 (falta $3.500)
      await moneyHandler?.({ source: 'ELECTRONIC_BOARD_BILL', amount: 5000 });
      await flushPromises();

      // Paso 3: segundo billete de $5.000 → cubre + $1.500 de cambio → auto-commit
      await moneyHandler?.({ source: 'ELECTRONIC_BOARD_BILL', amount: 5000 });
      await flushPromises();
      await flushPromises(); // cadena de autoCompleteSession

      // ── Verificaciones ───────────────────────────────────────────────────

      // Validación QR enviada al servidor
      expect(serverLinkService.validatePaymentCandidate).toHaveBeenCalledTimes(1);
      expect(serverLinkService.validatePaymentCandidate).toHaveBeenCalledWith({
        ppeTransactionUuid: 'pipeline-1',
        qrCode: 'ticket-001',
        vehiclePlate: null,
      });

      // Dos transacciones de efectivo (una por billete)
      expect(dataSource.transaction).toHaveBeenCalledTimes(2);

      // Inventario de efectivo aceptado: dos veces $5.000 (dentro de transacción)
      expect(cashInventoryService.recordAcceptedCashWithManager).toHaveBeenCalledTimes(2);
      expect(cashInventoryService.recordAcceptedCashWithManager).toHaveBeenCalledWith(
        expect.objectContaining({ denominationId: 5000, quantity: 1 }),
        expect.anything(),
      );

      // Plan de cambio calculado sobre $1.500, restringido a slots activos (bill1=1000, coin1=500)
      expect(cashChangeService.planChange).toHaveBeenCalledWith(1500, expect.any(Set));

      // Comando de devolución enviado a la placa usando la config de slots de la DB
      // (un solo trama combinado con las 4 denominaciones, vía returnChange — el
      // descuento de dispenser_slots ahora ocurre dentro de PeripheralsService,
      // sin esperar ACK por denominación individual)
      expect(peripheralsService.returnChange).toHaveBeenCalledWith([
        { slotKey: 'bill1', denomination: 1000, quantity: 1 },
        { slotKey: 'coin1', denomination: 500, quantity: 1 },
      ]);

      // Commit al servidor con los totales correctos
      expect(serverLinkService.commitPayment).toHaveBeenCalledWith({
        ppeTransactionUuid: 'pipeline-1',
        processId: 123,
        qrCode: 'ticket-001',
        vehiclePlate: 'PPE001',
        targetAmount: 8500,
        insertedAmount: 10000,
        changeAmount: 1500,
        expectedOutcomeDatetime: null,
        committedBy: 'auto',
      });

      // Aceptación activada (QR) y desactivada al cubrir monto + cierre final
      expect(peripheralsService.activateAcceptance).toHaveBeenCalled();
      expect(peripheralsService.deactivateAcceptance).toHaveBeenCalledTimes(2);

      // Intentos de sincronización guardados
      expect(syncAttemptRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          requestType: ServerSyncAttemptType.Validate,
          status: ServerSyncAttemptStatus.Success,
        }),
      );
      expect(syncAttemptRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          requestType: ServerSyncAttemptType.Commit,
          status: ServerSyncAttemptStatus.Success,
        }),
      );

      // Eventos clave registrados en la sesión
      expect(paymentSessionEventRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'payment.qr.accepted' }),
      );
      expect(paymentSessionEventRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'payment.change.dispensed' }),
      );
      expect(paymentSessionEventRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'payment.session.completed' }),
      );
    });
  });

  it('rejects a high bill when dispenser slots cannot guarantee change', async () => {
    const { service, paymentSessionRepository, cashInventoryService, dataSource } = createService();

    paymentSessionRepository.findOne.mockResolvedValue(
      makeSession({
        status: PaymentSessionStatus.ListeningCash,
        targetAmount: 7000,
        insertedAmount: 0,
      }),
    );
    cashInventoryService.getAcceptancePolicy.mockResolvedValue({
      pendingAmount: 7000,
      acceptedBillDenominations: [1000, 2000, 5000],
      maxAcceptedBill: 5000,
      message: 'Solo se admiten denominaciones hasta $5.000',
      dispensableDenominations: [2000, 500],
    });

    await expect(
      service.registerCash('session-1', {
        denominationId: 10000,
        quantity: 1,
        createdBy: 'unit-test',
      }),
    ).rejects.toBeInstanceOf(CashDenominationRejectedError);

    expect(dataSource.transaction).not.toHaveBeenCalled();
  });

  it('accepts a $50.000 bill as regular cash when the acceptance policy allows it', async () => {
    const {
      service,
      paymentSessionRepository,
      cashInventoryService,
      kioskStateService,
      kioskEventsService,
      peripheralsService,
      dataSource,
    } = createService();

    let moneyHandler: ((event: { source: string; amount: number }) => void) | undefined;
    peripheralsService.onMoneyReceived.mockImplementation(
      (h: typeof moneyHandler) => {
        moneyHandler = h;
      },
    );
    service.onApplicationBootstrap();

    paymentSessionRepository.findOne.mockResolvedValue(
      makeSession({
        id: 'session-1',
        status: PaymentSessionStatus.ListeningCash,
        targetAmount: 60000,
        insertedAmount: 0,
      }),
    );
    cashInventoryService.getAcceptancePolicy.mockResolvedValue({
      pendingAmount: 60000,
      acceptedBillDenominations: [1000, 2000, 5000, 10000, 20000, 50000, 100000],
      maxAcceptedBill: 100000,
      message: '',
      dispensableDenominations: [20000, 10000],
    });
    dataSource.transaction.mockImplementation(
      async (cb: (m: Record<string, unknown>) => Promise<void>) => {
        const manager = {
          findOneByOrFail: jest.fn().mockResolvedValue(
            makeSession({
              id: 'session-1',
              status: PaymentSessionStatus.ListeningCash,
              targetAmount: 60000,
              insertedAmount: 0,
            }),
          ),
          findOne: jest.fn().mockResolvedValue(null),
          save: jest.fn().mockImplementation(async (_cls: unknown, entity: unknown) => entity),
          create: jest.fn((_cls: unknown, value: unknown) => value),
        };
        await cb(manager);
      },
    );

    moneyHandler!({ source: 'BILL_VALIDATOR', amount: 50000 });
    await new Promise((resolve) => setImmediate(resolve));

    expect(cashInventoryService.recordAcceptedCashWithManager).toHaveBeenCalledWith(
      expect.objectContaining({ denominationId: 50000, quantity: 1 }),
      expect.anything(),
    );
    expect(cashInventoryService.recordCashIncident).not.toHaveBeenCalled();
    expect(kioskStateService.setPaymentsBlocked).not.toHaveBeenCalled();
    expect(kioskEventsService.emit).not.toHaveBeenCalledWith(
      'machine.large-bill-blocked',
      expect.anything(),
    );
  });

  it('stops accepting more cash once the target amount has been covered', async () => {
    const { service, paymentSessionRepository, dataSource } = createService();

    paymentSessionRepository.findOne.mockResolvedValue(
      makeSession({
        status: PaymentSessionStatus.ChangePending,
        targetAmount: 7000,
        insertedAmount: 8000,
        changeAmount: 1000,
      }),
    );

    await expect(
      service.registerCash('session-1', {
        denominationId: 1000,
        quantity: 1,
        createdBy: 'unit-test',
      }),
    ).rejects.toBeInstanceOf(PaymentSessionConflictError);

    expect(dataSource.transaction).not.toHaveBeenCalled();
  });
});
