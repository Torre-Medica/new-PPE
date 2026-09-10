import { fireSimEvent } from './sim-events';
import type {
  CashCloseoutSummary,
  CashDashboardSummary,
  CashMovement,
  CollectorTestStatus,
  CompletedPaymentSummary,
  DenominationInfo,
  DeviceStatusSummary,
  DispenserSlot,
  ElectronicBillingCatalogs,
  ElectronicBillingCustomerPayload,
  ElectronicBillingCustomerSearch,
  ElectronicBillingSelection,
  InventorySlot,
  KioskStateSummary,
  MonthlySubscriptionDetails,
  ServerLinkStatus,
} from './types';
import type { KioskSessionSummary } from './api';

const SIM_SESSION_ID = 'sim-session-001';
const API_PREFIX = '/api';
const NOW = () => new Date().toISOString();

type SimBackendSession = {
  id?: string;
  paymentSessionId?: string;
  status?: string;
  sessionType?: 'VISITOR' | 'MONTHLY_SUBSCRIPTION';
  qrCode?: string | null;
  identificationType?: string | null;
  identificationCode?: string | null;
  identifierLabel?: 'UUID' | 'Cedula';
  identifierValue?: string;
  targetAmount?: number;
  insertedAmount?: number;
  changeAmount?: number;
  concept?: string | null;
  vehiclePlate?: string | null;
  monthlySubscription?: MonthlySubscriptionDetails | null;
  enteredAt?: string;
  startedAt?: string;
  acceptancePolicy?: KioskSessionSummary['acceptancePolicy'];
};

// --- Mutable sim state (survives re-renders within a session) ---

let _slots: DispenserSlot[] = [
  { slotKey: 'bill1', denominationId: 1000, label: 'Billetero #1', isActive: true, quantity: 50 },
  { slotKey: 'bill2', denominationId: 2000, label: 'Billetero #2', isActive: true, quantity: 30 },
  { slotKey: 'coin1', denominationId: 500,  label: 'Monedero #1', isActive: true, quantity: 100 },
  { slotKey: 'coin2', denominationId: 200,  label: 'Monedero #2', isActive: true, quantity: 80 },
];

const _movements: CashMovement[] = [];
let _collectorEnabled = false;

const resolve = <T>(value: T): Promise<T> => Promise.resolve(value);
const delay = <T>(value: T, ms = 400): Promise<T> =>
  new Promise((r) => setTimeout(() => r(value), ms));

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_PREFIX}${path}`, {
    ...init,
    headers: {
      Accept: 'application/json',
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...init?.headers,
    },
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(text || `Backend PPE respondio ${response.status}`);
  }

  if (response.status === 204) {
    return null as T;
  }

  return response.json() as Promise<T>;
}

function sessionIdOf(session: SimBackendSession) {
  return session.paymentSessionId ?? session.id ?? SIM_SESSION_ID;
}

function toKioskSummary(session: SimBackendSession): KioskSessionSummary {
  return {
    paymentSessionId: sessionIdOf(session),
    status: session.status ?? 'VALIDATED',
    sessionType: session.sessionType,
    qrCode: session.qrCode,
    identificationType: session.identificationType,
    identificationCode: session.identificationCode,
    identifierLabel:
      session.identifierLabel ??
      (session.identificationType === 'CC' ? 'Cedula' : 'UUID'),
    identifierValue:
      session.identifierValue ??
      session.identificationCode ??
      session.qrCode ??
      '',
    targetAmount: Number(session.targetAmount ?? 0),
    insertedAmount: Number(session.insertedAmount ?? 0),
    changeAmount: Number(session.changeAmount ?? 0),
    concept: session.concept,
    vehiclePlate: session.vehiclePlate,
    monthlySubscription: session.monthlySubscription ?? null,
    enteredAt: session.enteredAt ?? session.startedAt ?? NOW(),
    acceptancePolicy: session.acceptancePolicy ?? null,
  };
}

function fireReviewReady(session: SimBackendSession) {
  const summary = toKioskSummary(session);
  fireSimEvent('session.review-ready', {
    paymentSessionId: summary.paymentSessionId,
    sessionType: summary.sessionType,
    qrCode: summary.qrCode,
    identificationType: summary.identificationType,
    identificationCode: summary.identificationCode,
    identifierLabel: summary.identifierLabel,
    identifierValue: summary.identifierValue,
    targetAmount: summary.targetAmount,
    enteredAt: summary.enteredAt,
    concept: summary.concept,
    vehiclePlate: summary.vehiclePlate,
    monthlySubscription: summary.monthlySubscription,
    acceptancePolicy: summary.acceptancePolicy,
  });
}

function fireCollectingEnabled(session: SimBackendSession) {
  const summary = toKioskSummary(session);
  fireSimEvent('session.collecting-enabled', {
    paymentSessionId: summary.paymentSessionId,
    insertedAmount: summary.insertedAmount,
    targetAmount: summary.targetAmount,
    acceptancePolicy: summary.acceptancePolicy,
  });
}

function fireCashReceived(
  session: SimBackendSession,
  inserted?: { denominationId: number; quantity: number },
) {
  const summary = toKioskSummary(session);
  fireSimEvent('cash.received', {
    paymentSessionId: summary.paymentSessionId,
    status: summary.status,
    insertedAmount: summary.insertedAmount,
    targetAmount: summary.targetAmount,
    pendingAmount: Math.max(0, summary.targetAmount - summary.insertedAmount),
    denominationId: inserted?.denominationId,
    quantity: inserted?.quantity,
    readyToComplete:
      summary.status === 'READY_TO_COMMIT' ||
      summary.status === 'CHANGE_PENDING' ||
      summary.insertedAmount >= summary.targetAmount,
    acceptancePolicy: summary.acceptancePolicy,
  });
}

function fireCompleted(session: SimBackendSession) {
  const summary = toKioskSummary(session);
  fireSimEvent('session.completed', {
    paymentSessionId: summary.paymentSessionId,
    insertedAmount: summary.insertedAmount,
    targetAmount: summary.targetAmount,
    changeAmount: summary.changeAmount,
  });
}

// --- Kiosk / payment ---

export function fetchKioskState(): Promise<KioskStateSummary> {
  return apiFetch<KioskStateSummary>('/kiosk/state');
}

export function setKioskMode(mode: 'PAYMENT' | 'MAINTENANCE', changedBy: string) {
  return apiFetch('/kiosk/mode', {
    method: 'POST',
    body: JSON.stringify({ mode, changedBy }),
  });
}

export function fetchActiveKioskSession(): Promise<KioskSessionSummary | null> {
  return apiFetch<SimBackendSession | null>('/kiosk/active-session')
    .then((session) => (session ? toKioskSummary(session) : null));
}

export function activateKioskCollection(
  paymentSessionId: string,
  initiatedBy: string,
  electronicBilling?: ElectronicBillingSelection,
) {
  return apiFetch<SimBackendSession>(`/kiosk/sim/payment-sessions/${paymentSessionId}/collect`, {
    method: 'POST',
    body: JSON.stringify({ initiatedBy, electronicBilling }),
  }).then((session) => {
    fireCollectingEnabled(session);
    return session;
  });
}

export function validateMonthlySubscriptionPlate(
  paymentSessionId: string,
  plate: string,
  monthsForPay = 1,
) {
  return apiFetch<SimBackendSession>(
    `/kiosk/sim/payment-sessions/${paymentSessionId}/monthly-subscription/validate`,
    {
      method: 'POST',
      body: JSON.stringify({ plate, monthsForPay }),
    },
  ).then((session) => {
    fireReviewReady(session);
    return toKioskSummary(session);
  });
}

export function startSimulatedPaymentSession(targetAmount: number, qrCode: string) {
  return apiFetch<SimBackendSession>('/kiosk/sim/start', {
    method: 'POST',
    body: JSON.stringify({
      targetAmount,
      qrCode,
      identificationType: 'QR',
      identificationCode: qrCode,
      concept: 'Parqueadero',
      metadataJson: JSON.stringify({
        simulator: true,
        requestedAmount: targetAmount,
      }),
    }),
  }).then((session) => {
    if (session.status !== 'VALIDATED') {
      const reason = session.status === 'FAILED'
        ? 'El QR no fue validado por nexo_back'
        : `La sesion quedo en estado ${session.status ?? 'desconocido'}`;
      fireSimEvent('qr.ignored', { reason });
      throw new Error(reason);
    }

    return fetchActiveKioskSession().then((activeSession) => {
      const summary = activeSession ?? toKioskSummary(session);
      fireReviewReady(summary);
      return summary;
    });
  });
}

export function insertSimulatedCash(paymentSessionId: string, denominationId: number) {
  return apiFetch<SimBackendSession>(`/kiosk/sim/payment-sessions/${paymentSessionId}/cash`, {
    method: 'POST',
    body: JSON.stringify({
      denominationId,
      quantity: 1,
      createdBy: 'simulator',
    }),
  }).then(async (session) => {
    fireCashReceived(session, { denominationId, quantity: 1 });

    if (Number(session.insertedAmount ?? 0) >= Number(session.targetAmount ?? 0)) {
      const completed = await apiFetch<SimBackendSession>(
        `/kiosk/sim/payment-sessions/${sessionIdOf(session)}/complete`,
        {
          method: 'POST',
          body: JSON.stringify({ committedBy: 'simulator' }),
        },
      );
      fireCompleted(completed);
      return completed;
    }

    return session;
  });
}

export function cancelKioskSession(paymentSessionId: string) {
  return apiFetch(`/kiosk/sim/payment-sessions/${paymentSessionId}/cancel`, {
    method: 'POST',
  }).finally(() => {
    fireSimEvent('session.canceled', { paymentSessionId });
  });
}

export function touchKioskSession(_paymentSessionId: string) {
  return resolve({});
}

export function printKioskReceipt(paymentSessionId: string) {
  return apiFetch(`/kiosk/payment-sessions/${paymentSessionId}/print-receipt`, {
    method: 'POST',
  });
}

export function fetchElectronicBillingCatalogs(): Promise<ElectronicBillingCatalogs> {
  return apiFetch<ElectronicBillingCatalogs>('/electronic-billing/catalogs');
}

export function searchElectronicBillingCustomer(
  identification: string,
): Promise<ElectronicBillingCustomerSearch> {
  return apiFetch<ElectronicBillingCustomerSearch>(
    `/electronic-billing/customers/${encodeURIComponent(identification)}`,
  );
}

export function createElectronicBillingCustomer(
  payload: ElectronicBillingCustomerPayload,
): Promise<unknown> {
  return apiFetch('/electronic-billing/customers', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

// --- Auth ---

export function loginAdmin(_email: string, _password: string): Promise<{ accessToken: string }> {
  return delay({ accessToken: 'sim-access-token' });
}

// --- Cash inventory ---

export function fetchCashInventory(_accessToken: string): Promise<InventorySlot[]> {
  return resolve([]);
}

export function loadCashInventory(_accessToken: string, _payload: object) {
  return resolve({});
}

export function unloadCashInventory(_accessToken: string, _payload: object) {
  return resolve({});
}

export function fetchCashMovements(_accessToken: string): Promise<CashMovement[]> {
  return resolve(_movements);
}

export function fetchCashDashboard(_accessToken: string): Promise<CashDashboardSummary> {
  return resolve({
    cycleStartedAt: NOW(),
    paymentsBlocked: false,
    blockReason: null,
    kioskMode: 'PAYMENT',
    changeInventoryTotal: _slots.reduce(
      (sum, s) => sum + (s.denominationId ?? 0) * s.quantity,
      0,
    ),
    transactionCount: 2,
    totalCollected: 13500,
    collectionLines: [],
    lastCloseout: null,
  });
}

export function fetchCashCloseouts(_accessToken: string, _limit = 5): Promise<CashCloseoutSummary[]> {
  return resolve([]);
}

export function createCashCloseout(
  _accessToken: string,
  _payload: { closedBy: string; closeoutType: 'PARTIAL' | 'TOTAL'; notes?: string },
): Promise<CashCloseoutSummary> {
  const closeout: CashCloseoutSummary = {
    id: 1,
    periodStartedAt: NOW(),
    periodEndedAt: NOW(),
    closedAt: NOW(),
    closedBy: _payload.closedBy,
    closeoutType: _payload.closeoutType,
    transactionCount: 2,
    totalCollected: 13500,
    notes: _payload.notes ?? null,
    receiptJson: null,
    createdAt: NOW(),
    lines: [],
  };
  return delay(closeout);
}

export function printCashCloseoutReceipt(_accessToken: string, _closeoutId: number) {
  return delay({});
}

// --- Dispensers ---

export function fetchDispenserSlots(_accessToken: string): Promise<DispenserSlot[]> {
  return resolve([..._slots]);
}

export function updateDispenserSlot(
  _accessToken: string,
  slotKey: string,
  payload: { denominationId?: number | null; quantity?: number },
): Promise<DispenserSlot> {
  const idx = _slots.findIndex((s) => s.slotKey === slotKey);
  if (idx !== -1) {
    _slots[idx] = { ..._slots[idx], ...payload } as DispenserSlot;
    return resolve({ ..._slots[idx] });
  }
  return Promise.reject(new Error('Slot no encontrado'));
}

function _slotAction(
  slotKey: string,
  action: 'load' | 'unload',
  payload: { quantity: number; reason?: string; createdBy?: string },
): Promise<DispenserSlot> {
  const idx = _slots.findIndex((s) => s.slotKey === slotKey);
  if (idx === -1) return Promise.reject(new Error('Slot no encontrado'));
  const slot = _slots[idx];
  const delta = action === 'load' ? payload.quantity : -payload.quantity;
  const newQty = Math.max(0, slot.quantity + delta);
  _slots[idx] = { ...slot, quantity: newQty };
  if (slot.denominationId) {
    _movements.unshift({
      id: _movements.length + 1,
      type: action === 'load' ? 'LOAD' : 'UNLOAD',
      denominationId: slot.denominationId,
      quantity: payload.quantity,
      unitValue: slot.denominationId,
      totalValue: slot.denominationId * payload.quantity,
      reason: payload.reason ?? '',
      paymentSessionId: null,
      createdBy: payload.createdBy ?? 'sim',
      createdAt: NOW(),
      denomination: { id: slot.denominationId, kind: slotKey.startsWith('coin') ? 'COIN' : 'BILL', currency: 'COP', isActive: true },
    });
  }
  return delay({ ..._slots[idx] });
}

export function loadCashInventoryAndSlot(
  _accessToken: string,
  slotKey: string,
  _currentPhysQty: number,
  payload: { quantity: number; reason?: string; createdBy?: string },
): Promise<DispenserSlot> {
  return _slotAction(slotKey, 'load', payload);
}

export function unloadCashInventoryAndSlot(
  _accessToken: string,
  slotKey: string,
  _currentPhysQty: number,
  payload: { quantity: number; reason?: string; createdBy?: string },
): Promise<DispenserSlot> {
  return _slotAction(slotKey, 'unload', payload);
}

export function ejectDispenserUnit(
  _accessToken: string,
  payload: { slotKey: 'bill1' | 'bill2' | 'coin1' | 'coin2'; quantity?: number },
) {
  return _slotAction(payload.slotKey, 'unload', { quantity: payload.quantity ?? 1, reason: 'Expulsado por admin' }).then(
    (slot) => ({
      slotKey: slot.slotKey,
      denominationId: slot.denominationId ?? 0,
      quantity: 1,
      totalDispensed: slot.denominationId ?? 0,
    }),
  );
}

// --- Devices ---

export function fetchDevices(_accessToken: string): Promise<DeviceStatusSummary[]> {
  return resolve([
    { id: 1, code: 'BILL_VALIDATOR_01', name: 'Validador de billetes', type: 'BILL_VALIDATOR', driver: 'JCM', port: '/dev/ttyUSB0', status: 'OK', lastError: null, lastHeartbeatAt: NOW() },
    { id: 2, code: 'COIN_ACCEPTOR_01', name: 'Aceptador de monedas', type: 'COIN_ACCEPTOR', driver: 'HOP', port: '/dev/ttyUSB1', status: 'OK', lastError: null, lastHeartbeatAt: NOW() },
    { id: 3, code: 'DISPENSER_01', name: 'Dispensador de cambio', type: 'DISPENSER', driver: 'NV11', port: '/dev/ttyUSB2', status: 'OK', lastError: null, lastHeartbeatAt: NOW() },
  ]);
}

export function fetchServerLinkStatus(_accessToken: string): Promise<ServerLinkStatus> {
  return resolve({ connected: true, url: 'http://sim-server:3001', namespace: '/kiosk', deviceUuid: 'sim-device-uuid' });
}

// --- Payments ---

export function fetchCompletedPaymentsToday(_accessToken: string): Promise<CompletedPaymentSummary[]> {
  return resolve([
    {
      id: 'sim-pay-001',
      serverProcessId: 1,
      serverPaymentId: 101,
      serverSyncStatus: 'SYNCED',
      qrCode: null,
      vehiclePlate: 'ABC123',
      vehicleType: null,
      identificationType: 'Cedula',
      identificationCode: '1234567890',
      concept: 'Parqueadero — Zona A',
      targetAmount: 5000,
      insertedAmount: 5000,
      changeAmount: 0,
      status: 'COMPLETED',
      startedAt: NOW(),
      completedAt: NOW(),
      failureReason: null,
      metadataJson: null,
      createdAt: NOW(),
      updatedAt: NOW(),
    },
    {
      id: 'sim-pay-002',
      serverProcessId: 2,
      serverPaymentId: 102,
      serverSyncStatus: 'SYNCED',
      qrCode: null,
      vehiclePlate: 'XYZ789',
      vehicleType: null,
      identificationType: 'Cedula',
      identificationCode: '0987654321',
      concept: 'Parqueadero — Zona B',
      targetAmount: 8500,
      insertedAmount: 10000,
      changeAmount: 1500,
      status: 'COMPLETED',
      startedAt: NOW(),
      completedAt: NOW(),
      failureReason: null,
      metadataJson: null,
      createdAt: NOW(),
      updatedAt: NOW(),
    },
  ]);
}

export function fetchDenominations(_accessToken: string): Promise<DenominationInfo[]> {
  return resolve([
    { id: 200,   kind: 'COIN', currency: 'COP', isActive: true },
    { id: 500,   kind: 'COIN', currency: 'COP', isActive: true },
    { id: 1000,  kind: 'BILL', currency: 'COP', isActive: true },
    { id: 2000,  kind: 'BILL', currency: 'COP', isActive: true },
    { id: 5000,  kind: 'BILL', currency: 'COP', isActive: true },
    { id: 10000, kind: 'BILL', currency: 'COP', isActive: true },
    { id: 20000, kind: 'BILL', currency: 'COP', isActive: true },
    { id: 50000, kind: 'BILL', currency: 'COP', isActive: true },
  ]);
}

// --- Collector test ---

export function fetchCollectorTestStatus(_accessToken: string): Promise<CollectorTestStatus> {
  return resolve({ enabled: _collectorEnabled, samples: [] });
}

export function startCollectorTest(_accessToken: string, _initiatedBy: string): Promise<CollectorTestStatus> {
  _collectorEnabled = true;
  return delay({ enabled: true, samples: [] });
}

export function stopCollectorTest(_accessToken: string, _initiatedBy: string): Promise<CollectorTestStatus> {
  _collectorEnabled = false;
  return delay({ enabled: false, samples: [] });
}

// Re-export the session ID so SimPanel can reference it
export { SIM_SESSION_ID };
