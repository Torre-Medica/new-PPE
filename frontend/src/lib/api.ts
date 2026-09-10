import type {
  CashCloseoutSummary,
  CashDashboardSummary,
  CashMovement,
  CollectorTestStatus,
  CompletedPaymentSummary,
  CollectorSample,
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

const API_PREFIX = '/api';
const BOGOTA_TIME_ZONE = 'America/Bogota';

export interface KioskSessionSummary {
  paymentSessionId: string;
  status: string;
  sessionType?: 'VISITOR' | 'MONTHLY_SUBSCRIPTION';
  qrCode?: string | null;
  identificationType?: string | null;
  identificationCode?: string | null;
  identifierLabel: 'UUID' | 'Cedula';
  identifierValue: string;
  targetAmount: number;
  insertedAmount: number;
  changeAmount: number;
  concept?: string | null;
  vehiclePlate?: string | null;
  enteredAt: string;
  monthlySubscription?: MonthlySubscriptionDetails | null;
  acceptancePolicy?: {
    pendingAmount: number;
    acceptedBillDenominations: number[];
    maxAcceptedBill: number;
    message: string;
    dispensableDenominations: number[];
  } | null;
}

async function readApiError(response: Response, fallback: string): Promise<string> {
  const text = await response.text().catch(() => '');
  if (!text) {
    return fallback;
  }

  try {
    const parsed = JSON.parse(text) as { message?: unknown; error?: unknown };
    if (typeof parsed.message === 'string' && parsed.message.trim()) {
      return parsed.message;
    }
    if (typeof parsed.error === 'string' && parsed.error.trim()) {
      return parsed.error;
    }
  } catch {
    return text;
  }

  return fallback;
}

export async function fetchKioskState(): Promise<KioskStateSummary> {
  const response = await fetch(`${API_PREFIX}/kiosk/state`);
  if (!response.ok) {
    throw new Error('No fue posible consultar el estado del kiosko');
  }

  return response.json() as Promise<KioskStateSummary>;
}

export async function setKioskMode(mode: 'PAYMENT' | 'MAINTENANCE', changedBy: string) {
  const response = await fetch(`${API_PREFIX}/kiosk/mode`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ mode, changedBy }),
  });

  if (!response.ok) {
    throw new Error('No fue posible cambiar el modo del kiosko');
  }

  return response.json();
}

export async function fetchActiveKioskSession(): Promise<KioskSessionSummary | null> {
  const response = await fetch(`${API_PREFIX}/kiosk/active-session`);
  if (response.status === 204) return null;
  if (!response.ok) {
    throw new Error('No fue posible consultar la sesion activa del kiosko');
  }

  const text = await response.text();
  if (!text || text.trim() === 'null') return null;
  return JSON.parse(text) as KioskSessionSummary;
}

export async function activateKioskCollection(
  paymentSessionId: string,
  initiatedBy: string,
  electronicBilling?: ElectronicBillingSelection,
) {
  const response = await fetch(`${API_PREFIX}/kiosk/payment-sessions/${paymentSessionId}/collect`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ initiatedBy, electronicBilling }),
  });

  if (!response.ok) {
    throw new Error('No fue posible habilitar la recepcion de efectivo');
  }

  return response.json();
}

export async function validateMonthlySubscriptionPlate(
  paymentSessionId: string,
  plate: string,
  monthsForPay = 1,
): Promise<KioskSessionSummary> {
  const response = await fetch(
    `${API_PREFIX}/kiosk/payment-sessions/${paymentSessionId}/monthly-subscription/validate`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ plate, monthsForPay }),
    },
  );

  if (!response.ok) {
    throw new Error(
      await readApiError(response, 'No fue posible validar la mensualidad'),
    );
  }

  return response.json() as Promise<KioskSessionSummary>;
}

export async function fetchElectronicBillingCatalogs(): Promise<ElectronicBillingCatalogs> {
  const response = await fetch(`${API_PREFIX}/electronic-billing/catalogs`);
  if (!response.ok) {
    throw new Error('No fue posible cargar datos de facturacion');
  }

  return response.json() as Promise<ElectronicBillingCatalogs>;
}

export async function searchElectronicBillingCustomer(
  identification: string,
): Promise<ElectronicBillingCustomerSearch> {
  const response = await fetch(
    `${API_PREFIX}/electronic-billing/customers/${encodeURIComponent(identification)}`,
  );
  if (!response.ok) {
    throw new Error('No fue posible consultar el tercero');
  }

  return response.json() as Promise<ElectronicBillingCustomerSearch>;
}

export async function createElectronicBillingCustomer(
  payload: ElectronicBillingCustomerPayload,
): Promise<unknown> {
  const response = await fetch(`${API_PREFIX}/electronic-billing/customers`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(text || 'No fue posible registrar el tercero');
  }

  return response.json();
}

export async function cancelKioskSession(paymentSessionId: string) {
  const response = await fetch(`${API_PREFIX}/kiosk/payment-sessions/${paymentSessionId}/cancel`, {
    method: 'POST',
  });

  if (!response.ok) {
    throw new Error('No fue posible cancelar la sesion del kiosko');
  }

  return response.json();
}

export async function touchKioskSession(paymentSessionId: string) {
  const response = await fetch(`${API_PREFIX}/kiosk/payment-sessions/${paymentSessionId}/touch`, {
    method: 'POST',
  });

  if (!response.ok) {
    throw new Error('No fue posible extender la sesion de cobro');
  }

  return response.json();
}

export async function printKioskReceipt(paymentSessionId: string) {
  const response = await fetch(`${API_PREFIX}/kiosk/payment-sessions/${paymentSessionId}/print-receipt`, {
    method: 'POST',
  });

  if (!response.ok) {
    throw new Error('No fue posible imprimir el comprobante');
  }

  return response.json();
}

export async function loginAdmin(email: string, password: string) {
  const response = await fetch(`${API_PREFIX}/auth/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email, password }),
  });

  if (!response.ok) {
    throw new Error('Credenciales invalidas');
  }

  return response.json() as Promise<{ accessToken: string }>;
}

export async function fetchCashInventory(accessToken: string): Promise<InventorySlot[]> {
  const response = await fetch(`${API_PREFIX}/cash/inventory`, {
    headers: createAuthHeaders(accessToken),
  });

  if (!response.ok) {
    throw new Error('No fue posible consultar el inventario');
  }

  return response.json() as Promise<InventorySlot[]>;
}

export async function loadCashInventory(
  accessToken: string,
  payload: { denominationId: number; quantity: number; reason?: string; createdBy?: string },
) {
  const response = await fetch(`${API_PREFIX}/cash/load`, {
    method: 'POST',
    headers: {
      ...createAuthHeaders(accessToken),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error('No fue posible registrar el cargue de efectivo');
  }

  return response.json();
}

export async function unloadCashInventory(
  accessToken: string,
  payload: { denominationId: number; quantity: number; reason?: string; createdBy?: string },
) {
  const response = await fetch(`${API_PREFIX}/cash/unload`, {
    method: 'POST',
    headers: {
      ...createAuthHeaders(accessToken),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error('No fue posible registrar el descargue de efectivo');
  }

  return response.json();
}

export async function fetchCashMovements(accessToken: string): Promise<CashMovement[]> {
  const response = await fetch(`${API_PREFIX}/cash/movements`, {
    headers: createAuthHeaders(accessToken),
  });

  if (!response.ok) {
    throw new Error('No fue posible consultar los movimientos de caja');
  }

  return response.json() as Promise<CashMovement[]>;
}

export async function fetchCashDashboard(accessToken: string): Promise<CashDashboardSummary> {
  const response = await fetch(`${API_PREFIX}/cash/dashboard`, {
    headers: createAuthHeaders(accessToken),
  });

  if (!response.ok) {
    throw new Error('No fue posible consultar el dashboard de caja');
  }

  return response.json() as Promise<CashDashboardSummary>;
}

export async function fetchCashCloseouts(
  accessToken: string,
  limit = 5,
): Promise<CashCloseoutSummary[]> {
  const response = await fetch(`${API_PREFIX}/cash/closeouts?limit=${limit}`, {
    headers: createAuthHeaders(accessToken),
  });

  if (!response.ok) {
    throw new Error('No fue posible consultar los cierres de caja');
  }

  return response.json() as Promise<CashCloseoutSummary[]>;
}

export async function createCashCloseout(
  accessToken: string,
  payload: { closedBy: string; closeoutType: 'PARTIAL' | 'TOTAL'; notes?: string },
): Promise<CashCloseoutSummary> {
  const response = await fetch(`${API_PREFIX}/cash/closeouts`, {
    method: 'POST',
    headers: {
      ...createAuthHeaders(accessToken),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error('No fue posible ejecutar el cierre de caja');
  }

  return response.json() as Promise<CashCloseoutSummary>;
}

export async function printCashCloseoutReceipt(accessToken: string, closeoutId: number) {
  const response = await fetch(`${API_PREFIX}/cash/closeouts/${closeoutId}/print`, {
    method: 'POST',
    headers: createAuthHeaders(accessToken),
  });

  if (!response.ok) {
    throw new Error('No fue posible imprimir la tirilla de cierre');
  }

  return response.json();
}

export async function ejectDispenserUnit(
  accessToken: string,
  payload: { slotKey: 'bill1' | 'bill2' | 'coin1' | 'coin2'; quantity?: number },
) {
  const response = await fetch(`${API_PREFIX}/dispensers/eject`, {
    method: 'POST',
    headers: {
      ...createAuthHeaders(accessToken),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const raw = await response.text().catch(() => '');
    const msg = (() => {
      try { return (JSON.parse(raw) as { message?: string }).message ?? raw; } catch { return raw; }
    })();
    throw new Error(msg || 'No fue posible expulsar una unidad del slot');
  }

  return response.json() as Promise<{
    slotKey: string;
    denominationId: number;
    quantity: number;
    totalDispensed: number;
  }>;
}

export async function fetchDevices(accessToken: string): Promise<DeviceStatusSummary[]> {
  const response = await fetch(`${API_PREFIX}/devices`, {
    headers: createAuthHeaders(accessToken),
  });

  if (!response.ok) {
    throw new Error('No fue posible consultar los dispositivos');
  }

  return response.json() as Promise<DeviceStatusSummary[]>;
}

export async function fetchServerLinkStatus(accessToken: string): Promise<ServerLinkStatus> {
  const response = await fetch(`${API_PREFIX}/server-link/status`, {
    headers: createAuthHeaders(accessToken),
  });

  if (!response.ok) {
    throw new Error('No fue posible consultar el enlace con nexo_back');
  }

  return response.json() as Promise<ServerLinkStatus>;
}

export async function fetchCompletedPaymentsToday(
  accessToken: string,
): Promise<CompletedPaymentSummary[]> {
  const dateRange = resolveTodayRange();
  const search = new URLSearchParams({
    dateFrom: dateRange.dateFrom,
    dateTo: dateRange.dateTo,
  });
  const response = await fetch(`${API_PREFIX}/payments/completed/search?${search.toString()}`, {
    headers: createAuthHeaders(accessToken),
  });

  if (!response.ok) {
    throw new Error('No fue posible consultar los pagos completados del dia');
  }

  return response.json() as Promise<CompletedPaymentSummary[]>;
}

export async function fetchDenominations(accessToken: string): Promise<DenominationInfo[]> {
  const response = await fetch(`${API_PREFIX}/cash/denominations`, {
    headers: createAuthHeaders(accessToken),
  });

  if (!response.ok) {
    throw new Error('No fue posible consultar las denominaciones');
  }

  return response.json() as Promise<DenominationInfo[]>;
}

export async function fetchDispenserSlots(accessToken: string): Promise<DispenserSlot[]> {
  const response = await fetch(`${API_PREFIX}/dispensers/slots`, {
    headers: createAuthHeaders(accessToken),
  });

  if (!response.ok) {
    throw new Error('No fue posible consultar los slots del dispensador');
  }

  return response.json() as Promise<DispenserSlot[]>;
}

export async function fetchCollectorTestStatus(accessToken: string): Promise<CollectorTestStatus> {
  const response = await fetch(`${API_PREFIX}/dispensers/collector-test`, {
    headers: createAuthHeaders(accessToken),
  });

  if (!response.ok) {
    throw new Error('No fue posible consultar el modo de prueba de receptores');
  }

  return response.json() as Promise<CollectorTestStatus>;
}

export async function startCollectorTest(
  accessToken: string,
  initiatedBy: string,
): Promise<CollectorTestStatus> {
  const response = await fetch(`${API_PREFIX}/dispensers/collector-test/start`, {
    method: 'POST',
    headers: {
      ...createAuthHeaders(accessToken),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ initiatedBy }),
  });

  if (!response.ok) {
    const raw = await response.text().catch(() => '');
    const msg = (() => { try { return (JSON.parse(raw) as { message?: string }).message ?? raw; } catch { return raw; } })();
    throw new Error(msg || 'No fue posible activar la prueba de receptores');
  }

  return response.json() as Promise<CollectorTestStatus>;
}

export async function stopCollectorTest(
  accessToken: string,
  initiatedBy: string,
): Promise<CollectorTestStatus> {
  const response = await fetch(`${API_PREFIX}/dispensers/collector-test/stop`, {
    method: 'POST',
    headers: {
      ...createAuthHeaders(accessToken),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ initiatedBy }),
  });

  if (!response.ok) {
    const raw = await response.text().catch(() => '');
    const msg = (() => { try { return (JSON.parse(raw) as { message?: string }).message ?? raw; } catch { return raw; } })();
    throw new Error(msg || 'No fue posible desactivar la prueba de receptores');
  }

  return response.json() as Promise<CollectorTestStatus>;
}

export async function updateDispenserSlot(
  accessToken: string,
  slotKey: string,
  payload: { denominationId?: number | null; quantity?: number },
): Promise<DispenserSlot> {
  const response = await fetch(`${API_PREFIX}/dispensers/slots/${slotKey}`, {
    method: 'PATCH',
    headers: {
      ...createAuthHeaders(accessToken),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const raw = await response.text().catch(() => '');
    const msg = (() => {
      try { return (JSON.parse(raw) as { message?: string }).message ?? raw; } catch { return raw; }
    })();
    throw new Error(msg || `Error ${response.status} al actualizar el slot`);
  }

  return response.json() as Promise<DispenserSlot>;
}

async function slotCashAction(
  accessToken: string,
  slotKey: string,
  action: 'load' | 'unload',
  payload: { quantity: number; reason?: string; createdBy?: string },
): Promise<DispenserSlot> {
  const response = await fetch(`${API_PREFIX}/dispensers/slots/${slotKey}/${action}`, {
    method: 'POST',
    headers: { ...createAuthHeaders(accessToken), 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const raw = await response.text().catch(() => '');
    const msg = (() => { try { return (JSON.parse(raw) as { message?: string }).message ?? raw; } catch { return raw; } })();
    throw new Error(msg || `No fue posible ${action === 'load' ? 'cargar' : 'retirar'} efectivo del slot`);
  }
  return response.json() as Promise<DispenserSlot>;
}

export function loadCashInventoryAndSlot(
  accessToken: string,
  slotKey: string,
  _currentPhysQty: number,
  payload: { quantity: number; reason?: string; createdBy?: string },
): Promise<DispenserSlot> {
  return slotCashAction(accessToken, slotKey, 'load', payload);
}

export function unloadCashInventoryAndSlot(
  accessToken: string,
  slotKey: string,
  _currentPhysQty: number,
  payload: { quantity: number; reason?: string; createdBy?: string },
): Promise<DispenserSlot> {
  return slotCashAction(accessToken, slotKey, 'unload', payload);
}

function createAuthHeaders(accessToken: string) {
  return {
    Authorization: `Bearer ${accessToken}`,
  };
}

function resolveTodayRange() {
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: BOGOTA_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const year = Number(parts.find((part) => part.type === 'year')?.value ?? '0');
  const month = Number(parts.find((part) => part.type === 'month')?.value ?? '0');
  const day = Number(parts.find((part) => part.type === 'day')?.value ?? '0');

  const start = new Date(Date.UTC(year, month - 1, day, 5, 0, 0, 0));
  const end = new Date(start.getTime() + (24 * 60 * 60 * 1000) - 1);

  return {
    dateFrom: start.toISOString(),
    dateTo: end.toISOString(),
  };
}
