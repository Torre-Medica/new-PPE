import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { KioskSessionSummary } from './lib/api';
import * as realApi from './lib/api';
import * as simApi from './lib/sim-api';
import { getSimEventSource } from './lib/sim-events';
import { SimPanel } from './components/SimPanel';
import { KeyboardModal } from './components/KeyboardModal';
import type { KbType } from './components/KeyboardModal';
import { useLogoUnlock } from './hooks/useLogoUnlock';

const SIMULATE = import.meta.env.VITE_SIMULATE === 'true';
const {
  activateKioskCollection,
  cancelKioskSession,
  createElectronicBillingCustomer,
  createCashCloseout,
  ejectDispenserUnit,
  fetchActiveKioskSession,
  fetchCashCloseouts,
  fetchCashDashboard,
  fetchCollectorTestStatus,
  fetchCashMovements,
  fetchCompletedPaymentsToday,
  fetchDenominations,
  fetchDevices,
  fetchDispenserSlots,
  fetchElectronicBillingCatalogs,
  fetchKioskState,
  fetchServerLinkStatus,
  loadCashInventoryAndSlot,
  loginAdmin,
  printCashCloseoutReceipt,
  printKioskReceipt,
  setKioskMode,
  searchElectronicBillingCustomer,
  startCollectorTest,
  stopCollectorTest,
  touchKioskSession,
  unloadCashInventoryAndSlot,
  updateDispenserSlot,
} = (SIMULATE ? simApi : realApi) as typeof realApi;
import type {
  AcceptancePolicy,
  AdminSession,
  CashCloseoutSummary,
  CashDashboardSummary,
  CashMovement,
  CollectorSample,
  CollectorTestStatus,
  CompletedPaymentSummary,
  DenominationInfo,
  DeviceStatusSummary,
  DispenserSlot,
  ElectronicBillingCatalogs,
  ElectronicBillingCustomerPayload,
  ElectronicBillingCustomerSearch,
  InsertedCashItem,
  KioskStateSummary,
  MonthlySubscriptionDetails,
  PaymentDetails,
  PaymentStage,
  RootMode,
  ServerLinkStatus,
} from './lib/types';

const currency = new Intl.NumberFormat('es-CO');
const BOGOTA_TIME_ZONE = 'America/Bogota';
const ADMIN_SESSION_KEY = 'ppe-admin-session';
const SERVER_LINK_DISCONNECTED_BY = 'server-link-disconnected';
const SERVER_LINK_MAINTENANCE_REASON = 'Sin conexion con nexo_back';

const SLOT_LABELS: Record<string, string> = {
  bill1: 'Billetero #1',
  bill2: 'Billetero #2',
  coin1: 'Monedero #1',
  coin2: 'Monedero #2',
};

const FIXED_PAYMENT_WARNINGS: string[] = [];
// Valores por defecto si el backend no responde con .timeouts (ej. version
// vieja) - en operacion normal, todo tiempo de espera lo controla el .env
// del PPE (ver PAYMENT_SESSION_*_TIMEOUT_MS) y llega via GET /kiosk/state.
const DEFAULT_SESSION_TIMEOUTS_SECONDS = {
  review: 30,
  cash: 30,
  billingDetails: 5 * 60,
  monthlySubscription: 2 * 60,
  finalizing: 30,
};
const VALLE_ABURRA_CITY_ORDER = [
  'medellin',
  'bello',
  'itagui',
  'envigado',
  'sabaneta',
  'la estrella',
  'caldas',
  'copacabana',
  'girardota',
  'barbosa',
];
const VALLE_ABURRA_CITY_INDEX = new Map(
  VALLE_ABURRA_CITY_ORDER.map((city, index) => [city, index]),
);

const formatReviewCountdown = (seconds: number) => {
  if (seconds >= 60) {
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')} min`;
  }

  return `${seconds} s`;
};

const normalizeCatalogText = (value: string) =>
  value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

const isGenericSuggestedCustomerName = (value: unknown) =>
  typeof value === 'string' && normalizeCatalogText(value).includes('tercero por registrar');

const isNaturalFiscalResponsibility = (item: { code: string; description: string }) => {
  const code = normalizeCatalogText(item.code);
  const description = normalizeCatalogText(item.description);

  return (
    code.includes('r-99') ||
    code.endsWith('pn') ||
    description.includes('no responsable') ||
    description.includes('no aplica')
  );
};

const filterFiscalResponsibilitiesByPersonType = (
  personType: 'Person' | 'Company',
  responsibilities: Array<{ id: number; code: string; description: string }>,
) => {
  const filtered = responsibilities.filter((item) =>
    personType === 'Person'
      ? isNaturalFiscalResponsibility(item)
      : !isNaturalFiscalResponsibility(item),
  );

  return filtered.length > 0 ? filtered : responsibilities;
};

const defaultFiscalResponsibilityIds = (
  personType: 'Person' | 'Company',
  responsibilities: Array<{ id: number; code: string; description: string }>,
) => {
  if (personType !== 'Person') {
    return [];
  }

  const defaultResponsibility =
    filterFiscalResponsibilitiesByPersonType(personType, responsibilities)[0];

  return defaultResponsibility ? [String(defaultResponsibility.id)] : [];
};

type BillingFormState = {
  personType: 'Person' | 'Company';
  identification: string;
  firstName: string;
  lastName: string;
  idIdentificationType: string;
  address: string;
  cityId: string;
  email: string;
  phoneNumber: string;
  vatResponsible: boolean;
  idCodeFiscalResponsabilities: string[];
  contactFirstName: string;
  contactLastName: string;
};

const createEmptyBillingForm = (): BillingFormState => ({
  personType: 'Person',
  identification: '',
  firstName: '',
  lastName: '',
  idIdentificationType: '',
  address: '',
  cityId: '',
  email: '',
  phoneNumber: '',
  vatResponsible: false,
  idCodeFiscalResponsabilities: [],
  contactFirstName: '',
  contactLastName: '',
});

const demoPayment: PaymentDetails = {
  identifierLabel: 'UUID',
  paymentSessionId: '',
  identifierValue: '',
  amountDue: 0,
  enteredAt: '',
  insertedAmount: 0,
  insertedItems: [],
  changeAmount: 0,
};

export default function App() {
  const [rootMode, setRootMode] = useState<RootMode>('payment');
  const [paymentStage, setPaymentStage] = useState<PaymentStage>('idle');
  const [paymentDetails, setPaymentDetails] = useState<PaymentDetails>(demoPayment);
  const [reviewCountdownSeconds, setReviewCountdownSeconds] = useState(30);
  const [collectingCountdownSeconds, setCollectingCountdownSeconds] = useState(30);
  const [finalizingCountdownSeconds, setFinalizingCountdownSeconds] = useState(30);
  const [paymentLoading, setPaymentLoading] = useState(false);
  const [collectingInteractionVersion, setCollectingInteractionVersion] = useState(0);
  const [reviewInteractionVersion, setReviewInteractionVersion] = useState(0);
  const [statusMessage, setStatusMessage] = useState('Escanee su QR para iniciar el pago');
  const [cancelNotice, setCancelNotice] = useState<string | null>(null);
  const [maintenanceReason, setMaintenanceReason] = useState<string | null>(null);
  const [electronicBillingEnabled, setElectronicBillingEnabled] = useState(false);
  const [electronicBillingRequested, setElectronicBillingRequested] = useState(false);
  const [showBillingChoiceScreen, setShowBillingChoiceScreen] = useState(false);
  const [showBillingDetailsScreen, setShowBillingDetailsScreen] = useState(false);
  const [billingDocument, setBillingDocument] = useState('');
  const [billingCustomer, setBillingCustomer] = useState<ElectronicBillingCustomerSearch | null>(null);
  const [billingCatalogs, setBillingCatalogs] = useState<ElectronicBillingCatalogs | null>(null);
  const [billingLoading, setBillingLoading] = useState(false);
  const [billingError, setBillingError] = useState('');
  const [showBillingForm, setShowBillingForm] = useState(false);
  const [billingForm, setBillingForm] = useState<BillingFormState>(() => createEmptyBillingForm());
  const [monthlyPlate, setMonthlyPlate] = useState('');
  const [sessionTimeoutsSeconds, setSessionTimeoutsSeconds] = useState(DEFAULT_SESSION_TIMEOUTS_SECONDS);
  const collectingTouchAtRef = useRef(0);
  const reviewTouchAtRef = useRef(0);
  const paymentLoadingTimerRef = useRef<number | null>(null);
  const backendLostTimerRef = useRef<number | null>(null);
  const electronicBillingEnabledRef = useRef(false);
  const rootModeRef = useRef<RootMode>('payment');
  const paymentStageRef = useRef<PaymentStage>('idle');
  const [keyboardModal, setKeyboardModal] = useState<{
    label: string;
    initialValue: string;
    type: KbType;
    acceptLabel?: string;
    onAccept: (v: string) => void;
  } | null>(null);
  const kb = (label: string, value: string, type: KbType, setter: (v: string) => void) =>
    setKeyboardModal({ label, initialValue: value, type, onAccept: (v) => { setter(v); setKeyboardModal(null); } });
  const setBillingFormField = <K extends keyof BillingFormState>(
    key: K,
    value: BillingFormState[K],
  ) => setBillingForm((current) => ({ ...current, [key]: value }));
  const resetBillingFlow = () => {
    setElectronicBillingRequested(false);
    setShowBillingChoiceScreen(false);
    setShowBillingDetailsScreen(false);
    setBillingDocument('');
    setBillingCustomer(null);
    setBillingError('');
    setShowBillingForm(false);
    setBillingForm(createEmptyBillingForm());
  };
  const resetMonthlyFlow = () => {
    setMonthlyPlate('');
  };
  const setElectronicBillingFeature = (enabled: boolean) => {
    electronicBillingEnabledRef.current = enabled;
    setElectronicBillingEnabled(enabled);
  };
  const applyKioskState = (state: KioskStateSummary) => {
    setElectronicBillingFeature(state.features?.electronicBillingEnabled === true);

    const timeouts = state.timeouts;
    setSessionTimeoutsSeconds({
      review: msToSecondsOr(timeouts?.reviewMs, DEFAULT_SESSION_TIMEOUTS_SECONDS.review),
      cash: msToSecondsOr(timeouts?.cashMs, DEFAULT_SESSION_TIMEOUTS_SECONDS.cash),
      billingDetails: msToSecondsOr(
        timeouts?.billingDetailsMs,
        DEFAULT_SESSION_TIMEOUTS_SECONDS.billingDetails,
      ),
      monthlySubscription: msToSecondsOr(
        timeouts?.monthlySubscriptionMs,
        DEFAULT_SESSION_TIMEOUTS_SECONDS.monthlySubscription,
      ),
      finalizing: msToSecondsOr(timeouts?.finalizingMs, DEFAULT_SESSION_TIMEOUTS_SECONDS.finalizing),
    });

    if (state.mode === 'MAINTENANCE') {
      setMaintenanceReason(resolveKioskMaintenanceReason(state));
      setRootMode('maintenance');
      return;
    }

    setMaintenanceReason(null);
    setRootMode('payment');
  };

  const [adminSession, setAdminSession] = useState<AdminSession | null>(null);
  const [adminEmail, setAdminEmail] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [adminLoginLoading, setAdminLoginLoading] = useState(false);
  const [adminLoginError, setAdminLoginError] = useState('');
  const [adminDataLoading, setAdminDataLoading] = useState(false);
  const [adminDataError, setAdminDataError] = useState('');
  const [adminDashboard, setAdminDashboard] = useState<CashDashboardSummary | null>(null);
  const [adminCloseouts, setAdminCloseouts] = useState<CashCloseoutSummary[]>([]);
  const [adminDenominations, setAdminDenominations] = useState<DenominationInfo[]>([]);
  const [adminMovements, setAdminMovements] = useState<CashMovement[]>([]);
  const [adminDevices, setAdminDevices] = useState<DeviceStatusSummary[]>([]);
  const [adminCompletedPayments, setAdminCompletedPayments] = useState<CompletedPaymentSummary[]>([]);
  const [adminServerLink, setAdminServerLink] = useState<ServerLinkStatus | null>(null);
  const [adminRefreshedAt, setAdminRefreshedAt] = useState('');
  const [closeoutNotes, setCloseoutNotes] = useState('');
  const [closeoutLoading, setCloseoutLoading] = useState(false);
  const [closeoutPrintLoadingId, setCloseoutPrintLoadingId] = useState<number | null>(null);
  const [closeoutType, setCloseoutType] = useState<'PARTIAL' | 'TOTAL'>('PARTIAL');
  const [receiptPrinting, setReceiptPrinting] = useState(false);
  const [adminDispenserSlots, setAdminDispenserSlots] = useState<DispenserSlot[]>([]);
  const [collectorTestStatus, setCollectorTestStatus] = useState<CollectorTestStatus>({ enabled: false });
  const [collectorSamples, setCollectorSamples] = useState<CollectorSample[]>([]);
  const [collectorTestLoading, setCollectorTestLoading] = useState(false);
  const [slotActionKey, setSlotActionKey] = useState<string | null>(null);
  const [slotActionDir, setSlotActionDir] = useState<'load' | 'unload'>('load');
  const [slotActionQty, setSlotActionQty] = useState(1);
  const [slotActionReason, setSlotActionReason] = useState('');
  const [slotActionLoading, setSlotActionLoading] = useState(false);
  const [slotDenomLoading, setSlotDenomLoading] = useState<string | null>(null);
  const [slotEjectLoadingKey, setSlotEjectLoadingKey] = useState<string | null>(null);
  const [adminView, setAdminView] = useState<'home' | 'cargar-dinero' | 'dispositivos' | 'pagos-completados' | 'cierres'>('home');
  const [denomModalSlot, setDenomModalSlot] = useState<DispenserSlot | null>(null);
  const [denomModalValue, setDenomModalValue] = useState<number | null>(null);
  const [paymentDetailModal, setPaymentDetailModal] = useState<CompletedPaymentSummary | null>(null);
  const [closeoutFilterFrom, setCloseoutFilterFrom] = useState('');
  const [closeoutFilterTo, setCloseoutFilterTo] = useState('');
  const [paymentPrintLoadingId, setPaymentPrintLoadingId] = useState<string | null>(null);
  const [cargarSection, setCargarSection] = useState<string | null>(null);
  const [dispositivosSection, setDispositivosSection] = useState<string>('estado');
  const [cierresSection, setCierresSection] = useState<string>('ejecutar');
  const [pagosPage, setPagosPage] = useState(0);
  const PAGOS_PER_PAGE = 5;

  useEffect(() => {
    if (
      !electronicBillingEnabled ||
      !electronicBillingRequested ||
      billingCatalogs ||
      billingLoading
    ) {
      return;
    }

    setBillingLoading(true);
    setBillingError('');
    fetchElectronicBillingCatalogs()
      .then((catalogs) => setBillingCatalogs(catalogs))
      .catch(() => {
        setBillingError('No fue posible cargar los datos de facturacion');
      })
      .finally(() => setBillingLoading(false));
  }, [billingCatalogs, billingLoading, electronicBillingEnabled, electronicBillingRequested]);

  useEffect(() => {
    const responsibilities = billingCatalogs?.fiscalResponsibilities ?? [];
    if (!showBillingForm || responsibilities.length === 0) {
      return;
    }

    setBillingForm((current) => {
      const allowedIds = new Set(
        filterFiscalResponsibilitiesByPersonType(current.personType, responsibilities)
          .map((item) => String(item.id)),
      );
      const currentSelection = current.idCodeFiscalResponsabilities.filter((id) =>
        allowedIds.has(id),
      );
      const nextSelection = currentSelection.length > 0
        ? currentSelection
        : defaultFiscalResponsibilityIds(current.personType, responsibilities);

      if (
        nextSelection.length === current.idCodeFiscalResponsabilities.length &&
        nextSelection.every((id, index) => id === current.idCodeFiscalResponsabilities[index])
      ) {
        return current;
      }

      return {
        ...current,
        idCodeFiscalResponsabilities: nextSelection,
      };
    });
  }, [billingCatalogs, showBillingForm]);

  const exitToSelector = useCallback(async () => {
    if (adminSession?.accessToken && collectorTestStatus.enabled) {
      try {
        const nextStatus = await stopCollectorTest(adminSession.accessToken, adminSession.email);
        setCollectorTestStatus(nextStatus);
        setCollectorSamples(nextStatus.samples ?? []);
      } catch {
        // Si falla el apagado remoto, igual cerramos la sesion local para no bloquear al operador.
      }
    }

    clearStoredAdminSession();
    setAdminSession(null);
    setAdminPassword('');
    setAdminDataError('');
    setAdminLoginError('');
    setRootMode('mode-select');
  }, [adminSession, collectorTestStatus.enabled]);

  const unlock = useLogoUnlock(() => {
    void exitToSelector();
  });

  useEffect(() => {
    rootModeRef.current = rootMode;
  }, [rootMode]);

  useEffect(() => {
    paymentStageRef.current = paymentStage;
  }, [paymentStage]);

  useEffect(() => {
    const storedSession = readStoredAdminSession();
    if (storedSession) {
      setAdminSession(storedSession);
      setAdminEmail(storedSession.email);
    }

    void fetchKioskState()
      .then((state) => {
        applyKioskState(state);
        // La sesion activa es opcional; si falla no debe bloquear la carga del kiosko
        void fetchActiveKioskSession()
          .then((activeSession) => {
            if (activeSession) {
              applySessionSummary(activeSession);
            }
          })
          .catch(() => undefined);
      })
      .catch(() => {
        setRootMode('maintenance');
        setStatusMessage('Sin conexion con el backend PPE');
      });
  }, []);

  useEffect(() => {
    const eventSource = (
      SIMULATE ? getSimEventSource() : new EventSource('/api/kiosk/events')
    ) as unknown as EventSource;

    eventSource.addEventListener('qr.processing', () => {
      setPaymentStage('scanning');
      setStatusMessage('Validando lectura con el servidor...');
    });

    eventSource.addEventListener('qr.ignored', (event) => {
      const payload = parseEventPayload(event);
      setPaymentStage('idle');
      setPaymentDetails(demoPayment);
      resetBillingFlow();
      resetMonthlyFlow();
      setStatusMessage(
        typeof payload?.reason === 'string'
          ? payload.reason
          : 'Escanee su QR para iniciar el pago',
      );
    });

    eventSource.addEventListener('session.review-ready', (event) => {
      const payload = parseEventPayload(event);
      if (!payload) {
        return;
      }

      setRootMode('payment');
      setPaymentStage('review');
      resetBillingFlow();
      const monthlySubscription = parseMonthlySubscription(payload.monthlySubscription);
      const sessionType =
        asString(payload.sessionType) === 'MONTHLY_SUBSCRIPTION' ||
          monthlySubscription
          ? 'MONTHLY_SUBSCRIPTION'
          : 'VISITOR';
      setShowBillingChoiceScreen(
        electronicBillingEnabledRef.current && sessionType !== 'MONTHLY_SUBSCRIPTION',
      );
      if (sessionType === 'MONTHLY_SUBSCRIPTION') {
        setMonthlyPlate(
          monthlySubscription?.plate ??
            asString(payload.vehiclePlate) ??
            '',
        );
        setShowBillingDetailsScreen(false);
      } else {
        resetMonthlyFlow();
      }
      setPaymentDetails((current: PaymentDetails) => ({
        ...current,
        paymentSessionId: asString(payload.paymentSessionId),
        sessionType,
        identifierLabel: asString(payload.identifierLabel) === 'Cedula' ? 'Cedula' : 'UUID',
        identifierValue: asString(payload.identifierValue),
        amountDue: asNumber(payload.targetAmount),
        enteredAt: formatBackendDate(asString(payload.enteredAt)),
        insertedAmount: 0,
        insertedItems: [],
        changeAmount: 0,
        concept: asString(payload.concept),
        vehiclePlate: asString(payload.vehiclePlate) || null,
        status: 'VALIDATED',
        acceptancePolicy: parseAcceptancePolicy(payload.acceptancePolicy),
        monthlySubscription,
      }));
      setStatusMessage(
        sessionType === 'MONTHLY_SUBSCRIPTION'
          ? 'Mensualidad validada. Revise el valor a cobrar'
          : 'QR validado. Revise el valor a cobrar',
      );
    });

    eventSource.addEventListener('session.collecting-enabled', (event) => {
      const payload = parseEventPayload(event);
      if (!payload) {
        return;
      }

      if (paymentLoadingTimerRef.current !== null) {
        window.clearTimeout(paymentLoadingTimerRef.current);
        paymentLoadingTimerRef.current = null;
      }
      setPaymentLoading(false);
      setPaymentStage('collecting');
      setPaymentDetails((current: PaymentDetails) => ({
        ...current,
        paymentSessionId: asString(payload.paymentSessionId) || current.paymentSessionId,
        insertedAmount: asNumber(payload.insertedAmount),
        amountDue: asNumber(payload.targetAmount) || current.amountDue,
        status: 'LISTENING_CASH',
        acceptancePolicy: parseAcceptancePolicy(payload.acceptancePolicy),
      }));
      // setStatusMessage('Recepcion de efectivo habilitada');
    });

    eventSource.addEventListener('cash.received', (event) => {
      const payload = parseEventPayload(event);
      if (!payload) {
        return;
      }

      setPaymentStage('collecting');
      setPaymentDetails((current: PaymentDetails) => ({
        ...current,
        ...paymentDetailsFromCashEvent(current, payload),
      }));
    });

    eventSource.addEventListener('session.completed', (event) => {
      const payload = parseEventPayload(event);
      if (!payload) {
        return;
      }

      if (paymentLoadingTimerRef.current !== null) {
        window.clearTimeout(paymentLoadingTimerRef.current);
        paymentLoadingTimerRef.current = null;
      }
      setPaymentLoading(false);
      setPaymentStage('finalizing');
      const paymentRegistered = payload.paymentRegistered === true;
      setPaymentDetails((current: PaymentDetails) => ({
        ...current,
        paymentSessionId: asString(payload.paymentSessionId) || current.paymentSessionId,
        insertedAmount: asNumber(payload.insertedAmount),
        amountDue: asNumber(payload.targetAmount) || current.amountDue,
        changeAmount: asNumber(payload.changeAmount),
        status: paymentRegistered ? 'COMPLETED' : 'COMPLETED_WITH_WARNING',
        acceptancePolicy: null,
      }));
      // setStatusMessage('Pago finalizado. Puede imprimir su comprobante');
    });

    eventSource.addEventListener('machine.low-change-warning', (event) => {
      const payload = parseEventPayload(event);
      if (!payload) {
        return;
      }

      setPaymentDetails((current: PaymentDetails) => ({
        ...current,
        acceptancePolicy: parseAcceptancePolicy(payload.acceptancePolicy) ?? current.acceptancePolicy ?? null,
      }));
    });

    eventSource.addEventListener('collector.sample-received', (event) => {
      const payload = parseEventPayload(event);
      if (!payload) {
        return;
      }

      const sample: CollectorSample = {
        amount: asNumber(payload.amount),
        kind: asString(payload.kind) === 'COIN' ? 'COIN' : 'BILL',
        source: asString(payload.source),
        receivedAt: asString(payload.receivedAt) || new Date().toISOString(),
      };

      setCollectorSamples((current) => [sample, ...current].slice(0, 12));
    });

    const resetToIdleFromEvent = () => {
      if (paymentLoadingTimerRef.current !== null) {
        window.clearTimeout(paymentLoadingTimerRef.current);
        paymentLoadingTimerRef.current = null;
      }
      setPaymentLoading(false);
      setPaymentStage('idle');
      setPaymentDetails(demoPayment);
      resetBillingFlow();
      resetMonthlyFlow();
      setStatusMessage('Escanee su QR para iniciar el pago');
    };

    eventSource.addEventListener('session.timeout', (event) => {
      const payload = parseEventPayload(event as MessageEvent);
      if (paymentLoadingTimerRef.current !== null) {
        window.clearTimeout(paymentLoadingTimerRef.current);
        paymentLoadingTimerRef.current = null;
      }
      setPaymentLoading(false);
      const insertedAmt = payload && typeof payload.insertedAmount === 'number' ? payload.insertedAmount : 0;
      const msg = insertedAmt > 0
        ? 'Tiempo agotado. Tu efectivo sera devuelto automaticamente. Regresando al inicio...'
        : 'Sesion cancelada por inactividad. Regresando al inicio...';
      setCancelNotice((prev) => prev ?? msg);
    });
    eventSource.addEventListener('session.canceled', resetToIdleFromEvent);

    eventSource.addEventListener('machine.refund-alert', (event) => {
      const payload = parseEventPayload(event as MessageEvent);
      const reason = payload && typeof payload.reason === 'string'
        ? payload.reason
        : 'No fue posible devolver el efectivo automaticamente';
      setCancelNotice(null);
      setMaintenanceReason(reason);
      resetToIdleFromEvent();
      setRootMode('maintenance');
    });

    eventSource.addEventListener('machine.session-error', (event) => {
      const payload = parseEventPayload(event as MessageEvent);
      const reason = payload && typeof payload.reason === 'string'
        ? payload.reason
        : 'Ocurrio un error inesperado — contacte al operador';
      setCancelNotice(null);
      setMaintenanceReason(reason);
      resetToIdleFromEvent();
      setRootMode('maintenance');
    });

    eventSource.addEventListener('kiosk.mode.changed', (event) => {
      const payload = parseEventPayload(event);
      if (!payload) {
        return;
      }

      const mode = asString(payload.mode);
      setMaintenanceReason(
        mode === 'MAINTENANCE' ? resolveKioskMaintenanceReason(payload) : null,
      );
      setRootMode(mode === 'MAINTENANCE' ? 'maintenance' : 'payment');
    });

    const syncActiveSession = () => {
      void fetchActiveKioskSession()
        .then((session) => {
          if (!session) return;
          applySessionSummary(session);
        })
        .catch(() => undefined);
    };

    const syncKioskState = () => {
      void fetchKioskState()
        .then((state) => {
          if (rootModeRef.current === 'admin-dashboard' || rootModeRef.current === 'admin-login') {
            setElectronicBillingFeature(state.features?.electronicBillingEnabled === true);
            setMaintenanceReason(
              state.mode === 'MAINTENANCE' ? resolveKioskMaintenanceReason(state) : null,
            );
            return;
          }

          applyKioskState(state);
        })
        .catch(() => undefined);
    };

    eventSource.onopen = () => {
      if (backendLostTimerRef.current !== null) {
        window.clearTimeout(backendLostTimerRef.current);
        backendLostTimerRef.current = null;
        setStatusMessage('Escanee su QR para iniciar el pago');
      }
      // Recuperar estado perdido mientras la conexion SSE estuvo caida
      syncKioskState();
      syncActiveSession();
    };

    eventSource.onerror = () => {
      if (SIMULATE) return;
      if (backendLostTimerRef.current !== null) return;
      setStatusMessage('Reconectando con el backend...');
      backendLostTimerRef.current = window.setTimeout(() => {
        backendLostTimerRef.current = null;
        setRootMode('maintenance');
        setStatusMessage('Sin conexion con el backend PPE');
      }, 10_000);
    };

    return () => {
      eventSource.close();
      if (backendLostTimerRef.current !== null) {
        window.clearTimeout(backendLostTimerRef.current);
        backendLostTimerRef.current = null;
      }
    };
  }, []);


  useEffect(() => {
    if (paymentStage !== 'review') {
      return;
    }

    const handlePointerDown = () => {
      const now = Date.now();
      if (now - reviewTouchAtRef.current < 1000) {
        return;
      }
      reviewTouchAtRef.current = now;
      setReviewInteractionVersion((current) => current + 1);
    };

    window.addEventListener('pointerdown', handlePointerDown, { capture: true });
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown, { capture: true });
    };
  }, [paymentStage]);

  useEffect(() => {
    if (paymentStage !== 'review') {
      setReviewCountdownSeconds(sessionTimeoutsSeconds.review);
      return;
    }

    const monthlyReviewActive =
      paymentDetails.sessionType === 'MONTHLY_SUBSCRIPTION';

    const timeoutSeconds = showBillingDetailsScreen
      ? sessionTimeoutsSeconds.billingDetails
      : monthlyReviewActive
        ? sessionTimeoutsSeconds.monthlySubscription
        : sessionTimeoutsSeconds.review;

    setReviewCountdownSeconds(timeoutSeconds);

    const shouldKeepBackendSessionAlive = showBillingDetailsScreen || monthlyReviewActive;
    if (shouldKeepBackendSessionAlive && paymentDetails.paymentSessionId) {
      void touchKioskSession(paymentDetails.paymentSessionId).catch(() => undefined);
    }

    const countdownTimer = window.setInterval(() => {
      setReviewCountdownSeconds((s) => (s > 0 ? s - 1 : 0));
    }, 1000);

    const keepAliveTimer = shouldKeepBackendSessionAlive && paymentDetails.paymentSessionId
      ? window.setInterval(() => {
        void touchKioskSession(paymentDetails.paymentSessionId!).catch(() => undefined);
      }, 20_000)
      : null;

    const cancelTimer = window.setTimeout(() => {
      const sessionId = paymentDetails.paymentSessionId;
      if (sessionId) void cancelKioskSession(sessionId).catch(() => undefined);
      setCancelNotice((prev) => prev ?? 'Sesion cancelada por inactividad. Regresando al inicio...');
    }, timeoutSeconds * 1000);

    return () => {
      window.clearInterval(countdownTimer);
      if (keepAliveTimer !== null) {
        window.clearInterval(keepAliveTimer);
      }
      window.clearTimeout(cancelTimer);
    };
  }, [
    paymentStage,
    paymentDetails.paymentSessionId,
    paymentDetails.monthlySubscription?.validated,
    paymentDetails.sessionType,
    showBillingDetailsScreen,
    reviewInteractionVersion,
    sessionTimeoutsSeconds,
  ]);

  useEffect(() => {
    if (paymentStage !== 'finalizing') {
      setFinalizingCountdownSeconds(sessionTimeoutsSeconds.finalizing);
      return;
    }

    setFinalizingCountdownSeconds(sessionTimeoutsSeconds.finalizing);
    const countdownTimer = window.setInterval(() => {
      setFinalizingCountdownSeconds((current) => (current > 0 ? current - 1 : 0));
    }, 1000);

    const timer = window.setTimeout(() => {
      setPaymentStage('idle');
      setPaymentDetails(demoPayment);
      resetBillingFlow();
      resetMonthlyFlow();
      // setStatusMessage('Pago finalizado. Puede iniciar un nuevo cobro');
    }, sessionTimeoutsSeconds.finalizing * 1000);

    return () => {
      window.clearInterval(countdownTimer);
      window.clearTimeout(timer);
    };
  }, [paymentStage, sessionTimeoutsSeconds.finalizing]);

  useEffect(() => {
    if (paymentStage !== 'collecting') {
      setCollectingCountdownSeconds(sessionTimeoutsSeconds.cash);
      return;
    }

    setCollectingCountdownSeconds(sessionTimeoutsSeconds.cash);
    const countdownTimer = window.setInterval(() => {
      setCollectingCountdownSeconds((current) => (current > 0 ? current - 1 : 0));
    }, 1000);

    const capturedInsertedAmount = paymentDetails.insertedAmount;
    const capturedSessionId = paymentDetails.paymentSessionId;
    const cancelTimer = window.setTimeout(() => {
      if (capturedInsertedAmount === 0) {
        if (capturedSessionId) void cancelKioskSession(capturedSessionId).catch(() => undefined);
        setCancelNotice((prev) => prev ?? 'Sesion cancelada por inactividad. Regresando al inicio...');
      }
      // If money was inserted, the backend timeout handles the refund via session.timeout SSE event
    }, sessionTimeoutsSeconds.cash * 1000);

    return () => {
      window.clearInterval(countdownTimer);
      window.clearTimeout(cancelTimer);
    };
  }, [
    collectingInteractionVersion,
    paymentDetails.insertedAmount,
    paymentStage,
    sessionTimeoutsSeconds.cash,
  ]);

  useEffect(() => {
    if (!cancelNotice) return;
    const timer = window.setTimeout(() => {
      setCancelNotice(null);
      setPaymentStage('idle');
      setPaymentDetails(demoPayment);
      resetBillingFlow();
      resetMonthlyFlow();
      setPaymentLoading(false);
      setStatusMessage('Escanee su QR para iniciar el pago');
    }, 5_000);
    return () => window.clearTimeout(timer);
  }, [cancelNotice]);

  useEffect(() => {
    if (rootMode !== 'admin-dashboard') {
      return;
    }

    if (!adminSession?.accessToken) {
      setRootMode('admin-login');
      return;
    }

    setAdminView('home');
    void refreshAdminDashboard(adminSession.accessToken);
  }, [adminSession, rootMode]);

  useEffect(() => {
    if (rootMode !== 'admin-dashboard' || !adminSession?.accessToken || !collectorTestStatus.enabled) {
      return;
    }

    const timer = window.setInterval(() => {
      void fetchCollectorTestStatus(adminSession.accessToken)
        .then((snapshot) => {
          setCollectorTestStatus(snapshot);
          setCollectorSamples(snapshot.samples ?? []);
        })
        .catch(() => undefined);
    }, 1000);

    return () => window.clearInterval(timer);
  }, [adminSession, collectorTestStatus.enabled, rootMode]);

  // Polling de seguridad: en modo cobro, verifica cada 2s si el estado real de la
  // sesion en el servidor coincide con lo que muestra la pantalla. Antes esto solo
  // corria en 'idle', asi que un evento SSE puntual perdido en cualquier otra etapa
  // (scanning/review/collecting/finalizing) dejaba la pantalla pegada indefinidamente
  // sin ningun mecanismo de recuperacion — el reconnect de EventSource (onopen) solo
  // ayuda si la conexion se cae del todo, no si un solo evento se pierde sin caida.
  useEffect(() => {
    if (rootMode !== 'payment') return;

    const timer = window.setInterval(() => {
      void fetchActiveKioskSession()
        .then((session) => {
          if (!session) {
            // El servidor no tiene sesion activa — si la pantalla sigue mostrando
            // una en curso (fuera de 'idle'), quedo desincronizada tras completarse
            // o cancelarse sin que llegara el evento correspondiente.
            //
            // 'finalizing' es la excepcion: ahi la sesion YA se cerro en el backend
            // apenas se completo el pago, asi que "sin sesion activa" es el estado
            // normal mientras se muestra la pantalla de exito/impresion. Esa etapa
            // tiene su propio temporizador de 30s (mas arriba) que decide cuando
            // volver a 'idle' — si este sondeo tambien reacciona aqui, la tumba a
            // los 2s en vez de esperar los 30s de rigor.
            if (paymentStageRef.current !== 'idle' && paymentStageRef.current !== 'finalizing') {
              setPaymentStage('idle');
              setPaymentDetails(demoPayment);
              resetBillingFlow();
              resetMonthlyFlow();
              setStatusMessage('Escanee su QR para iniciar el pago');
            }
            return;
          }
          applySessionSummary(session);
        })
        .catch(() => undefined);
    }, 2000);

    return () => window.clearInterval(timer);
  }, [rootMode]);

  const pendingAmount = useMemo(
    () => Math.max(0, paymentDetails.amountDue - paymentDetails.insertedAmount),
    [paymentDetails.amountDue, paymentDetails.insertedAmount],
  );
  const billingCustomerLabel = useMemo(() => {
    if (!billingCustomer?.exist) {
      return '';
    }

    const data = billingCustomer.data;
    const firstName =
      typeof data.first_name === 'string'
        ? data.first_name
        : typeof data.firstName === 'string'
          ? data.firstName
          : '';
    const lastName =
      typeof data.last_name === 'string'
        ? data.last_name
        : typeof data.lastName === 'string'
          ? data.lastName
          : '';
    const legalName =
      typeof data.razonSocial === 'string' ? data.razonSocial : '';

    return `${firstName} ${lastName}`.trim() || legalName || billingDocument;
  }, [billingCustomer, billingDocument]);
  const billingCities = useMemo(() => {
    const cities = billingCatalogs?.cities ?? [];
    const valleAburraCities = cities
      .filter((city) => VALLE_ABURRA_CITY_INDEX.has(normalizeCatalogText(city.cityName)))
      .sort((first, second) => {
        const firstIndex = VALLE_ABURRA_CITY_INDEX.get(normalizeCatalogText(first.cityName)) ?? 999;
        const secondIndex = VALLE_ABURRA_CITY_INDEX.get(normalizeCatalogText(second.cityName)) ?? 999;
        return firstIndex - secondIndex;
      });

    return valleAburraCities.length > 0 ? valleAburraCities : cities;
  }, [billingCatalogs]);
  const billingFiscalResponsibilities = useMemo(
    () =>
      filterFiscalResponsibilitiesByPersonType(
        billingForm.personType,
        billingCatalogs?.fiscalResponsibilities ?? [],
      ),
    [billingCatalogs, billingForm.personType],
  );
  const paymentAcceptancePolicy = paymentDetails.acceptancePolicy ?? null;
  const hasRestrictedBills =
    !!paymentAcceptancePolicy &&
    paymentAcceptancePolicy.acceptedBillDenominations.length > 0 &&
    paymentAcceptancePolicy.acceptedBillDenominations.length < 7;
  const hasNoAcceptedBills =
    !!paymentAcceptancePolicy &&
    paymentAcceptancePolicy.acceptedBillDenominations.length === 0;
  const paymentWarningTone = hasNoAcceptedBills || hasRestrictedBills ? 'danger' : 'neutral';
  const paymentWarningSummary = paymentAcceptancePolicy
    ? hasNoAcceptedBills
      ? 'Cambio muy limitado en este momento. Pague con monedas o con el valor lo mas exacto posible.'
      : hasRestrictedBills
        ? `Cambio limitado. No inserte billetes superiores a $${currency.format(paymentAcceptancePolicy.maxAcceptedBill)}.`
        : 'Cambio disponible para operar con normalidad.'
    : 'Calculando politica de aceptacion segun el cambio disponible.';
  const paymentWarningDetail = paymentAcceptancePolicy
    ? hasNoAcceptedBills
      ? 'El equipo no tiene billetes habilitados para recibir porque podria no devolver cambio suficiente.'
      : hasRestrictedBills
        ? 'Si paga con un billete de alta denominacion, el equipo podria no tener devuelta suficiente.'
        : paymentAcceptancePolicy.message
    : '';
  const recommendedMoneyText = paymentAcceptancePolicy
    ? [
      ...paymentAcceptancePolicy.acceptedBillDenominations,
      ...paymentAcceptancePolicy.dispensableDenominations,
    ]
      .filter((value, index, source) => value > 0 && source.indexOf(value) === index)
      .sort((a, b) => a - b)
      .map((value) => `$${currency.format(value)}`)
      .join(', ')
    : '';
  const exactPaymentOnly =
    !!paymentAcceptancePolicy &&
    paymentAcceptancePolicy.acceptedBillDenominations.length === 0 &&
    paymentAcceptancePolicy.dispensableDenominations.length > 0;
  const isMonthlyPayment = paymentDetails.sessionType === 'MONTHLY_SUBSCRIPTION';
  const monthlySubscription = paymentDetails.monthlySubscription ?? null;
  const monthlySubscriptionValidated =
    !isMonthlyPayment ||
    (monthlySubscription?.validated === true && paymentDetails.amountDue > 0);
  const monthlyForecastedEndDate =
    monthlySubscription?.validationDetail?.requestedMonthlySubscriptionEndDatetime
      ? formatBackendDate(
          monthlySubscription.validationDetail.requestedMonthlySubscriptionEndDatetime,
        )
      : '-';

  const changeAvailableTotal = adminDashboard?.changeInventoryTotal ?? 0;
  const collectedTodayTotal = adminDashboard?.totalCollected ?? 0;
  const collectorTestTotal = useMemo(
    () => collectorSamples.reduce((sum, sample) => sum + sample.amount, 0),
    [collectorSamples],
  );

  const collectedTodayRows = useMemo(() => {
    return (adminDashboard?.collectionLines ?? []).map((line) => [
      `${line.kind === 'BILL' ? 'Billete' : 'Moneda'} $${currency.format(line.denominationId)}`,
      `${line.quantity} und`,
      `$${currency.format(line.subtotal)}`,
    ]) as Array<[string, string, string]>;
  }, [adminDashboard]);

  const deviceRows = useMemo((): Array<[string, string, string]> => {
    const byType = (...types: string[]) => adminDevices.find((d) => types.includes(d.type));
    const board = byType('ELECTRONIC_BOARD');
    const qr = byType('QR_SCANNER');
    const printer = byType('PRINTER', 'THERMAL_PRINTER', 'RECEIPT_PRINTER');
    const row = (label: string, device: typeof board): [string, string, string] => [
      label,
      device ? `${device.status}${device.port ? ` · ${device.port}` : ''}` : 'Sin registrar',
      device?.lastError ? 'Con alerta' : device ? 'OK' : '-',
    ];
    return [
      row('Tarjeta adaptadora billeteros y monederos', board),
      row('Lector QR', qr),
      row('Impresora', printer),
    ];
  }, [adminDevices]);

  const recentCloseoutRows = useMemo(
    () =>
      adminCloseouts.map((closeout) => [
        formatBackendDate(closeout.closedAt),
        `${closeout.closedBy} - ${closeout.transactionCount} trx`,
        `$${currency.format(closeout.totalCollected)}`,
      ]) as Array<[string, string, string]>,
    [adminCloseouts],
  );

  const recentMovementRows = useMemo(
    () =>
      adminMovements.slice(0, 8).map((movement) => [
        `${movement.type} $${currency.format(movement.denominationId)}`,
        `${movement.createdBy || 'Sistema'} - ${movement.quantity} und`,
        `$${currency.format(movement.totalValue)}`,
      ]) as Array<[string, string, string]>,
    [adminMovements],
  );

  const latestCloseoutLineRows = useMemo(() => {
    const latestCloseout = adminCloseouts[0];
    if (!latestCloseout) {
      return [] as Array<[string, string, string]>;
    }

    return latestCloseout.lines.map((line) => [
      `${line.denomination.kind === 'BILL' ? 'Billete' : 'Moneda'} $${currency.format(line.denominationId)}`,
      `${line.quantity} und`,
      `$${currency.format(line.subtotal)}`,
    ]) as Array<[string, string, string]>;
  }, [adminCloseouts]);

  const filteredCloseouts = useMemo(() => {
    return adminCloseouts.filter((closeout) => {
      const closedDate = new Date(closeout.closedAt);
      if (closeoutFilterFrom) {
        const from = new Date(closeoutFilterFrom);
        if (closedDate < from) return false;
      }
      if (closeoutFilterTo) {
        const to = new Date(closeoutFilterTo);
        to.setHours(23, 59, 59, 999);
        if (closedDate > to) return false;
      }
      return true;
    });
  }, [adminCloseouts, closeoutFilterFrom, closeoutFilterTo]);

  const applySessionSummary = (session: KioskSessionSummary) => {
    const details = paymentDetailsFromSession(session);
    setPaymentDetails(details);
    if (details.sessionType === 'MONTHLY_SUBSCRIPTION') {
      setMonthlyPlate(details.monthlySubscription?.plate ?? details.vehiclePlate ?? '');
      setShowBillingChoiceScreen(false);
      setShowBillingDetailsScreen(false);
    }

    if (session.status === 'VALIDATING' || session.status === 'CREATED') {
      setPaymentStage('scanning');
      setStatusMessage(
        details.sessionType === 'MONTHLY_SUBSCRIPTION'
          ? 'Validando cedula con el servidor...'
          : 'Validando QR con el servidor...',
      );
      return;
    }

    if (session.status === 'VALIDATED') {
      setPaymentStage('review');
      setShowBillingChoiceScreen(
        electronicBillingEnabledRef.current &&
          details.sessionType !== 'MONTHLY_SUBSCRIPTION',
      );
      setStatusMessage(
        details.sessionType === 'MONTHLY_SUBSCRIPTION'
          ? 'Mensualidad validada. Revise el valor a cobrar'
          : 'QR validado. Revise el valor a cobrar',
      );
      return;
    }

    if (
      session.status === 'LISTENING_CASH' ||
      session.status === 'CHANGE_PENDING' ||
      session.status === 'READY_TO_COMMIT'
    ) {
      setPaymentStage('collecting');
      // setStatusMessage('Recepcion de efectivo habilitada');
      return;
    }

    if (
      session.status === 'COMPLETED' ||
      session.status === 'COMPLETED_WITH_WARNING' ||
      session.status === 'COMMITTING_TO_SERVER'
    ) {
      setPaymentStage('finalizing');
      // setStatusMessage('Pago finalizado. Puede imprimir su comprobante');
      return;
    }

    setPaymentStage('idle');
  };

  const paymentDetailsFromSession = (session: KioskSessionSummary): PaymentDetails => ({
      paymentSessionId: session.paymentSessionId,
      identifierLabel: session.identifierLabel,
      identifierValue: session.identifierValue,
      sessionType: session.sessionType ?? (session.monthlySubscription ? 'MONTHLY_SUBSCRIPTION' : 'VISITOR'),
      amountDue: session.targetAmount,
      enteredAt: formatBackendDate(session.enteredAt),
      insertedAmount: session.insertedAmount,
      insertedItems: [],
      changeAmount: session.changeAmount,
      concept: session.concept ?? '',
      vehiclePlate: session.vehiclePlate ?? null,
      status: session.status,
      acceptancePolicy: session.acceptancePolicy ?? null,
      monthlySubscription: session.monthlySubscription ?? null,
  });

  const mergeInsertedItem = (
    items: InsertedCashItem[],
    denominationId: number,
    quantity: number,
  ): InsertedCashItem[] => {
    const existing = items.find((item) => item.denominationId === denominationId);
    if (!existing) {
      return [...items, { denominationId, quantity }].sort(
        (a, b) => b.denominationId - a.denominationId,
      );
    }
    return items.map((item) =>
      item.denominationId === denominationId
        ? { ...item, quantity: item.quantity + quantity }
        : item,
    );
  };

  const paymentDetailsFromCashEvent = (
    current: PaymentDetails,
    payload: Record<string, unknown>,
  ): Partial<PaymentDetails> => {
    const insertedAmount = asNumber(payload.insertedAmount);
    const targetAmount = asNumber(payload.targetAmount) || current.amountDue;
    const statusFromPayload = asString(payload.status);
    const readyToComplete = payload.readyToComplete === true || insertedAmount >= targetAmount;

    const eventDenominationId = asNumber(payload.denominationId);
    const eventQuantity = asNumber(payload.quantity) || 1;
    const insertedItems =
      eventDenominationId > 0
        ? mergeInsertedItem(current.insertedItems, eventDenominationId, eventQuantity)
        : current.insertedItems;

    return {
      insertedAmount,
      insertedItems,
      amountDue: targetAmount,
      changeAmount: Math.max(0, insertedAmount - targetAmount),
      status:
        statusFromPayload ||
        (readyToComplete
          ? insertedAmount > targetAmount
            ? 'CHANGE_PENDING'
            : 'READY_TO_COMMIT'
          : current.status),
      acceptancePolicy: parseAcceptancePolicy(payload.acceptancePolicy) ?? current.acceptancePolicy ?? null,
    };
  };

  const resetPaymentToIdle = (message: string) => {
    setPaymentStage('idle');
    setPaymentDetails(demoPayment);
    resetBillingFlow();
    resetMonthlyFlow();
    setStatusMessage(message);
  };

  const clearPaymentLoading = () => {
    if (paymentLoadingTimerRef.current !== null) {
      window.clearTimeout(paymentLoadingTimerRef.current);
      paymentLoadingTimerRef.current = null;
    }
    setPaymentLoading(false);
  };

  const handleBillingChoice = (requested: boolean) => {
    const nextRequested = electronicBillingEnabled && requested;

    setShowBillingChoiceScreen(false);
    setElectronicBillingRequested(nextRequested);
    setBillingError('');

    if (!nextRequested) {
      setShowBillingDetailsScreen(false);
      setBillingDocument('');
      setBillingCustomer(null);
      setShowBillingForm(false);
      setBillingForm(createEmptyBillingForm());
      return;
    }

    setShowBillingDetailsScreen(true);
    setBillingForm((current) => ({
      ...current,
      identification: billingDocument.trim(),
    }));
  };

  const cancelElectronicBilling = () => {
    setElectronicBillingRequested(false);
    setShowBillingChoiceScreen(false);
    setShowBillingDetailsScreen(false);
    setBillingDocument('');
    setBillingCustomer(null);
    setBillingError('');
    setShowBillingForm(false);
    setBillingForm(createEmptyBillingForm());
  };

  const continueToPaymentReview = () => {
    if (!electronicBillingEnabled) {
      setShowBillingDetailsScreen(false);
      return;
    }

    if (!billingCustomer?.exist) {
      setBillingError('Debe validar o registrar el tercero antes de continuar');
      return;
    }

    setBillingError('');
    setShowBillingDetailsScreen(false);
  };

  const searchBillingCustomerByDocument = async (documentValue: string) => {
    const document = documentValue.trim();
    if (document.length < 5) {
      setBillingError('Ingrese un documento valido');
      return;
    }

    setBillingLoading(true);
    setBillingError('');
    setBillingCustomer(null);
    setShowBillingForm(false);
    try {
      const customer = await searchElectronicBillingCustomer(document);
      setBillingCustomer(customer);
      if (!customer.exist) {
        const inferredPersonType =
          typeof customer.data.formaJuridica === 'string' &&
            customer.data.formaJuridica.toLowerCase().includes('jurid')
            ? 'Company'
            : 'Person';
        const suggestedName =
          typeof customer.data.razonSocial === 'string' &&
            !isGenericSuggestedCustomerName(customer.data.razonSocial)
            ? customer.data.razonSocial
            : '';
        const responsibilities = billingCatalogs?.fiscalResponsibilities ?? [];

        setShowBillingForm(true);
        setBillingForm((current) => ({
          ...current,
          identification: document,
          firstName: suggestedName,
          personType: inferredPersonType,
          vatResponsible: inferredPersonType === 'Company' ? current.vatResponsible : false,
          idCodeFiscalResponsabilities: defaultFiscalResponsibilityIds(
            inferredPersonType,
            responsibilities,
          ),
        }));
        setBillingError('Tercero no registrado. Complete el formulario.');
      }
    } catch {
      setBillingError('No fue posible consultar el tercero');
    } finally {
      setBillingLoading(false);
    }
  };

  const acceptBillingDocument = (value: string) => {
    const document = value.trim();
    setBillingDocument(document);
    setBillingCustomer(null);
    setShowBillingForm(false);
    setBillingForm({
      ...createEmptyBillingForm(),
      identification: document,
      idCodeFiscalResponsabilities: defaultFiscalResponsibilityIds(
        'Person',
        billingCatalogs?.fiscalResponsibilities ?? [],
      ),
    });
    void searchBillingCustomerByDocument(document);
  };

  const submitBillingCustomer = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const responsibilities = billingForm.idCodeFiscalResponsabilities
      .map((value) => Number(value))
      .filter((value) => Number.isFinite(value) && value > 0);

    if (!billingForm.idIdentificationType || !billingForm.cityId) {
      setBillingError('Seleccione tipo de documento y ciudad');
      return;
    }

    if (
      !billingForm.identification.trim() ||
      !billingForm.firstName.trim() ||
      !billingForm.email.trim() ||
      !billingForm.phoneNumber.trim() ||
      !billingForm.address.trim()
    ) {
      setBillingError('Complete los campos obligatorios del tercero');
      return;
    }

    if (billingForm.personType === 'Person' && !billingForm.lastName.trim()) {
      setBillingError('Ingrese el apellido de la persona natural');
      return;
    }

    if (
      billingForm.personType === 'Company' &&
      (!billingForm.contactFirstName.trim() || !billingForm.contactLastName.trim())
    ) {
      setBillingError('Ingrese los datos de contacto de la empresa');
      return;
    }

    const payload: ElectronicBillingCustomerPayload = {
      personType: billingForm.personType,
      identification: billingForm.identification.trim(),
      firstName: billingForm.firstName.trim(),
      lastName:
        billingForm.personType === 'Person'
          ? billingForm.lastName.trim()
          : undefined,
      idIdentificationType: Number(billingForm.idIdentificationType),
      address: billingForm.address.trim(),
      cityId: Number(billingForm.cityId),
      email: billingForm.email.trim(),
      phoneNumber: billingForm.phoneNumber.trim(),
      vatResponsible: billingForm.personType === 'Company' && billingForm.vatResponsible,
      idCodeFiscalResponsabilities:
        responsibilities.length > 0 ? responsibilities : undefined,
      contacts:
        billingForm.personType === 'Company'
          ? [
            {
              firstName: billingForm.contactFirstName.trim(),
              lastName: billingForm.contactLastName.trim(),
            },
          ]
          : undefined,
    };

    setBillingLoading(true);
    setBillingError('');
    try {
      await createElectronicBillingCustomer(payload);
      setBillingDocument(payload.identification);
      const customer = await searchElectronicBillingCustomer(payload.identification);
      setBillingCustomer(
        customer.exist
          ? customer
          : {
            exist: true,
            data: {
              identification: payload.identification,
              first_name: payload.firstName,
              last_name: payload.lastName ?? '',
            },
          },
      );
      setShowBillingForm(false);
    } catch (error) {
      setBillingError(error instanceof Error ? error.message : 'No fue posible registrar el tercero');
    } finally {
      setBillingLoading(false);
    }
  };

  const beginCollection = async () => {
    if (!paymentDetails.paymentSessionId || paymentLoading) {
      return;
    }

    if (isMonthlyPayment && !monthlySubscriptionValidated) {
      setStatusMessage('La mensualidad no quedo validada. Vuelva a escanear la cedula.');
      return;
    }

    const billingRequestedForPayment =
      electronicBillingEnabled && electronicBillingRequested && !isMonthlyPayment;
    const billingDocumentForPayment = billingDocument.trim();
    const electronicBilling = billingRequestedForPayment
      ? {
        enabled: true,
        customerIdentificationNumber: billingDocumentForPayment,
      }
      : undefined;

    if (billingRequestedForPayment) {
      if (!billingDocumentForPayment) {
        setBillingError('Ingrese el documento para facturacion');
        return;
      }

      if (!billingCustomer?.exist) {
        setBillingError('Debe validar o registrar el tercero antes de pagar');
        return;
      }
    }

    paymentLoadingTimerRef.current = window.setTimeout(() => {
      setPaymentLoading(true);
    }, 700);

    try {
      const collectionResult = await activateKioskCollection(
        paymentDetails.paymentSessionId,
        'touch-kiosk',
        electronicBilling,
      );
      const activeSession = await fetchActiveKioskSession().catch(() => null);

      clearPaymentLoading();

      if (activeSession) {
        applySessionSummary(activeSession);
        return;
      }

      const resultStatus =
        typeof collectionResult === 'object' &&
          collectionResult !== null &&
          'status' in collectionResult &&
          typeof collectionResult.status === 'string'
          ? collectionResult.status
          : '';

      if (resultStatus === 'FAILED') {
        setCancelNotice(
          'No fue posible habilitar la recepcion de efectivo. Revise los perifericos e intente de nuevo.',
        );
        return;
      }

      if (
        resultStatus === 'LISTENING_CASH' ||
        resultStatus === 'CHANGE_PENDING' ||
        resultStatus === 'READY_TO_COMMIT'
      ) {
        setPaymentStage('collecting');
        setPaymentDetails((current) => ({
          ...current,
          insertedAmount:
            typeof collectionResult === 'object' &&
              collectionResult !== null &&
              'insertedAmount' in collectionResult &&
              typeof collectionResult.insertedAmount === 'number'
              ? collectionResult.insertedAmount
              : current.insertedAmount,
          status: resultStatus,
        }));
        return;
      }

      setStatusMessage('No fue posible confirmar la recepcion de efectivo. Intente nuevamente.');
    } catch {
      clearPaymentLoading();
      setStatusMessage('No fue posible habilitar la recepcion de efectivo. Intente nuevamente.');
    }
  };

  const handleCollectingInteraction = useCallback(() => {
    if (paymentStage !== 'collecting' || !paymentDetails.paymentSessionId) {
      return;
    }

    const now = Date.now();
    if (now - collectingTouchAtRef.current < 1000) {
      return;
    }

    collectingTouchAtRef.current = now;
    setCollectingInteractionVersion((current) => current + 1);
    void touchKioskSession(paymentDetails.paymentSessionId).catch(() => undefined);
  }, [paymentDetails.paymentSessionId, paymentStage]);

  const goToPayment = async () => {
    await setKioskMode('PAYMENT', 'frontend-selector');
    setRootMode('payment');
    setPaymentStage('idle');
    setPaymentDetails(demoPayment);
    unlock.reset();
  };

  const goToMaintenance = async () => {
    await setKioskMode('MAINTENANCE', 'frontend-selector');
    setRootMode('maintenance');
    unlock.reset();
  };

  const doAdminLogin = async (email: string, password: string) => {
    setAdminLoginLoading(true);
    setAdminLoginError('');

    if (!email.trim() || !password) {
      setAdminLoginError('Ingrese correo y contrasena');
      setAdminLoginLoading(false);
      return;
    }

    try {
      const response = await loginAdmin(email, password);
      const nextSession: AdminSession = { accessToken: response.accessToken, email };
      persistAdminSession(nextSession);
      setAdminSession(nextSession);
      setAdminPassword('');
      setRootMode('admin-dashboard');
    } catch (error) {
      setAdminLoginError(error instanceof Error ? error.message : 'No fue posible iniciar sesion');
    } finally {
      setAdminLoginLoading(false);
    }
  };

  const handleAdminLogin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    await doAdminLogin(adminEmail, adminPassword);
  };

  const refreshAdminDashboard = async (accessToken: string) => {
    setAdminDataLoading(true);
    setAdminDataError('');

    try {
      const [dashboard, closeouts, movements, devices, serverLink, completedPayments, dispenserSlots, denominations, nextCollectorTestStatus] = await Promise.all([
        fetchCashDashboard(accessToken),
        fetchCashCloseouts(accessToken),
        fetchCashMovements(accessToken),
        fetchDevices(accessToken),
        fetchServerLinkStatus(accessToken),
        fetchCompletedPaymentsToday(accessToken),
        fetchDispenserSlots(accessToken),
        fetchDenominations(accessToken),
        fetchCollectorTestStatus(accessToken),
      ]);

      setAdminDashboard(dashboard);
      setAdminCloseouts(closeouts);
      setAdminMovements(movements);
      setAdminDevices(devices);
      setAdminServerLink(serverLink);
      setAdminCompletedPayments(completedPayments);
      setAdminDispenserSlots(dispenserSlots);
      setAdminDenominations(denominations);
      setCollectorTestStatus(nextCollectorTestStatus);
      setCollectorSamples(nextCollectorTestStatus.samples ?? []);
      setAdminRefreshedAt(formatCurrentBogotaDateTime());
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No fue posible cargar el dashboard';
      setAdminDataError(message);
    } finally {
      setAdminDataLoading(false);
    }
  };

  const handleCollectorTestToggle = async (enable: boolean) => {
    if (!adminSession?.accessToken) {
      return;
    }

    setCollectorTestLoading(true);
    setAdminDataError('');

    try {
      const nextStatus = enable
        ? await startCollectorTest(adminSession.accessToken, adminSession.email)
        : await stopCollectorTest(adminSession.accessToken, adminSession.email);
      setCollectorTestStatus(nextStatus);
      if (enable) {
        setCollectorSamples([]);
      } else {
        setCollectorSamples(nextStatus.samples ?? []);
      }
    } catch (error) {
      setAdminDataError(error instanceof Error ? error.message : 'No fue posible cambiar el modo de prueba');
    } finally {
      setCollectorTestLoading(false);
    }
  };

  const handleSlotDenomChange = async (slotKey: string, denominationId: number | null) => {
    if (!adminSession?.accessToken) return;
    setSlotDenomLoading(slotKey);
    try {
      await updateDispenserSlot(adminSession.accessToken, slotKey, { denominationId });
      setAdminDispenserSlots((prev) =>
        prev.map((s) => (s.slotKey === slotKey ? { ...s, denominationId } : s)),
      );
    } catch (error) {
      setAdminDataError(error instanceof Error ? error.message : 'No fue posible actualizar la denominacion del slot');
    } finally {
      setSlotDenomLoading(null);
    }
  };

  const handleSlotCashAction = async () => {
    if (!adminSession?.accessToken || !slotActionKey) return;
    const slot = adminDispenserSlots.find((s) => s.slotKey === slotActionKey);
    if (!slot?.denominationId) return;
    setSlotActionLoading(true);
    setAdminDataError('');
    try {
      const payload = {
        quantity: slotActionQty,
        reason: slotActionReason || undefined,
        createdBy: adminSession.email,
      };
      if (slotActionDir === 'load') {
        await loadCashInventoryAndSlot(adminSession.accessToken, slot.slotKey, slot.quantity, payload);
      } else {
        await unloadCashInventoryAndSlot(adminSession.accessToken, slot.slotKey, slot.quantity, payload);
      }
      setSlotActionKey(null);
      setSlotActionQty(1);
      setSlotActionReason('');
      await refreshAdminDashboard(adminSession.accessToken);
    } catch (error) {
      setAdminDataError(error instanceof Error ? error.message : 'No fue posible registrar el movimiento del slot');
    } finally {
      setSlotActionLoading(false);
    }
  };

  const handleCloseout = async (requestedType: 'PARTIAL' | 'TOTAL') => {
    if (!adminSession?.accessToken) {
      return;
    }

    setCloseoutLoading(true);
    setAdminDataError('');

    try {
      const closeout = await createCashCloseout(adminSession.accessToken, {
        closedBy: adminSession.email,
        closeoutType: requestedType,
        notes: closeoutNotes || undefined,
      });
      await printCashCloseoutReceipt(adminSession.accessToken, closeout.id);
      setCloseoutNotes('');
      await refreshAdminDashboard(adminSession.accessToken);
    } catch (error) {
      setAdminDataError(error instanceof Error ? error.message : 'No fue posible ejecutar el cierre');
    } finally {
      setCloseoutLoading(false);
    }
  };

  const handleSlotEject = async (slotKey: DispenserSlot['slotKey']) => {
    if (!adminSession?.accessToken) return;
    setSlotEjectLoadingKey(slotKey);
    setAdminDataError('');

    try {
      await ejectDispenserUnit(adminSession.accessToken, {
        slotKey,
        quantity: 1,
      });
      await refreshAdminDashboard(adminSession.accessToken);
    } catch (error) {
      setAdminDataError(error instanceof Error ? error.message : 'No fue posible expulsar una unidad');
    } finally {
      setSlotEjectLoadingKey(null);
    }
  };

  const handleCloseoutPrint = async (closeoutId: number) => {
    if (!adminSession?.accessToken) {
      return;
    }

    setCloseoutPrintLoadingId(closeoutId);
    setAdminDataError('');

    try {
      await printCashCloseoutReceipt(adminSession.accessToken, closeoutId);
    } catch (error) {
      setAdminDataError(error instanceof Error ? error.message : 'No fue posible imprimir la tirilla de cierre');
    } finally {
      setCloseoutPrintLoadingId(null);
    }
  };

  const handlePaymentPrint = async (paymentId: string) => {
    setPaymentPrintLoadingId(paymentId);
    setAdminDataError('');
    try {
      await printKioskReceipt(paymentId);
    } catch (error) {
      setAdminDataError(error instanceof Error ? error.message : 'No fue posible imprimir el comprobante');
    } finally {
      setPaymentPrintLoadingId(null);
    }
  };

  const logoutAdmin = () => {
    void exitToSelector();
  };

  const handlePrintChoice = async (shouldPrint: boolean) => {
    if (!shouldPrint) {
      resetPaymentToIdle('Pago finalizado exitosamente');
      return;
    }

    if (!paymentDetails.paymentSessionId) {
      setStatusMessage('No hay una sesion lista para imprimir');
      return;
    }

    setReceiptPrinting(true);

    try {
      await printKioskReceipt(paymentDetails.paymentSessionId);
      resetPaymentToIdle('Comprobante enviado a la impresora del PPE');
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : 'No fue posible imprimir el comprobante');
    } finally {
      setReceiptPrinting(false);
    }
  };

  const billingDetailsForm = (
    <div className="space-y-3">
      <input
        className="touch-input cursor-pointer"
        readOnly
        value={billingDocument}
        placeholder="Documento CC/NIT"
        onClick={() =>
          kb('Documento para factura', billingDocument, 'numeric', acceptBillingDocument)
        }
      />

      {billingCustomer?.exist && (
        <div className="rounded-3xl border border-ok-200 bg-ok-50 px-4 py-3 text-sm text-ok-700">
          Tercero validado: <strong>{billingCustomerLabel}</strong>
        </div>
      )}

      {billingError && (
        <div className="rounded-3xl border border-alert-200 bg-alert-50 px-4 py-3 text-sm text-alert-600">
          {billingError}
        </div>
      )}

      {showBillingForm && (
        <form className="grid gap-3 rounded-3xl border border-brand-100 bg-white/70 p-3" onSubmit={(event) => void submitBillingCustomer(event)}>
          <div className="grid gap-2 md:grid-cols-2">
            <select
              className="touch-input"
              value={billingForm.idIdentificationType}
              onChange={(event) => setBillingFormField('idIdentificationType', event.target.value)}
            >
              <option value="">Tipo de documento</option>
              {(billingCatalogs?.identificationTypes ?? []).map((type) => (
                <option key={type.id} value={type.id}>{type.identification}</option>
              ))}
            </select>
            <select
              className="touch-input"
              value={billingForm.personType}
              onChange={(event) => {
                const value = event.target.value === 'Company' ? 'Company' : 'Person';
                const responsibilities = billingCatalogs?.fiscalResponsibilities ?? [];
                setBillingForm((current) => ({
                  ...current,
                  personType: value,
                  vatResponsible: value === 'Company' ? current.vatResponsible : false,
                  idCodeFiscalResponsabilities: defaultFiscalResponsibilityIds(
                    value,
                    responsibilities,
                  ),
                }));
              }}
            >
              <option value="Person">Persona natural</option>
              <option value="Company">Persona juridica</option>
            </select>
          </div>

          <div className="grid gap-2 md:grid-cols-2">
            <input
              className="touch-input cursor-pointer"
              readOnly
              value={billingForm.identification}
              placeholder="Documento"
              onClick={() => kb('Documento', billingForm.identification, 'numeric', (value) => setBillingFormField('identification', value))}
            />
            <input
              className="touch-input cursor-pointer"
              readOnly
              value={billingForm.firstName}
              placeholder={billingForm.personType === 'Company' ? 'Razon social' : 'Nombre'}
              onClick={() =>
                kb(
                  billingForm.personType === 'Company' ? 'Razon social' : 'Nombre',
                  isGenericSuggestedCustomerName(billingForm.firstName) ? '' : billingForm.firstName,
                  'text',
                  (value) => setBillingFormField('firstName', value),
                )
              }
            />
          </div>

          {billingForm.personType === 'Person' ? (
            <input
              className="touch-input cursor-pointer"
              readOnly
              value={billingForm.lastName}
              placeholder="Apellido"
              onClick={() => kb('Apellido', billingForm.lastName, 'text', (value) => setBillingFormField('lastName', value))}
            />
          ) : (
            <div className="grid gap-2 md:grid-cols-2">
              <input
                className="touch-input cursor-pointer"
                readOnly
                value={billingForm.contactFirstName}
                placeholder="Nombre contacto"
                onClick={() => kb('Nombre contacto', billingForm.contactFirstName, 'text', (value) => setBillingFormField('contactFirstName', value))}
              />
              <input
                className="touch-input cursor-pointer"
                readOnly
                value={billingForm.contactLastName}
                placeholder="Apellido contacto"
                onClick={() => kb('Apellido contacto', billingForm.contactLastName, 'text', (value) => setBillingFormField('contactLastName', value))}
              />
            </div>
          )}

          <div className="grid gap-2 md:grid-cols-2">
            <input
              className="touch-input cursor-pointer"
              readOnly
              value={billingForm.email}
              placeholder="Correo electronico"
              onClick={() => kb('Correo electronico', billingForm.email, 'email', (value) => setBillingFormField('email', value))}
            />
            <input
              className="touch-input cursor-pointer"
              readOnly
              value={billingForm.phoneNumber}
              placeholder="Telefono"
              onClick={() => kb('Telefono', billingForm.phoneNumber, 'numeric', (value) => setBillingFormField('phoneNumber', value))}
            />
          </div>

          <div className="grid gap-2 md:grid-cols-2">
            <input
              className="touch-input cursor-pointer"
              readOnly
              value={billingForm.address}
              placeholder="Direccion"
              onClick={() => kb('Direccion', billingForm.address, 'text', (value) => setBillingFormField('address', value))}
            />
            <select
              className="touch-input"
              value={billingForm.cityId}
              onChange={(event) => setBillingFormField('cityId', event.target.value)}
            >
              <option value="">Ciudad</option>
              {billingCities.map((city) => (
                <option key={city.id} value={city.id}>{city.cityName}, {city.StateName}</option>
              ))}
            </select>
          </div>

          <div className="grid gap-2 md:grid-cols-[1fr_auto]">
            <select
              className="touch-input min-h-[4.5rem]"
              multiple
              value={billingForm.idCodeFiscalResponsabilities}
              onChange={(event) =>
                setBillingFormField(
                  'idCodeFiscalResponsabilities',
                  Array.from(event.currentTarget.selectedOptions).map((option) => option.value),
                )
              }
            >
              {billingFiscalResponsibilities.map((item) => (
                <option key={item.id} value={item.id}>{item.code} - {item.description}</option>
              ))}
            </select>
            <label className="flex min-h-[3rem] items-center gap-2 rounded-3xl border-2 border-black/10 bg-white/90 px-4 text-sm text-ink">
              <input
                type="checkbox"
                checked={billingForm.vatResponsible}
                disabled={billingForm.personType === 'Person'}
                onChange={(event) => setBillingFormField('vatResponsible', event.target.checked)}
              />
              Responsable IVA
            </label>
          </div>

          <button
            type="submit"
            className="touch-button-primary w-full"
            disabled={billingLoading}
          >
            {billingLoading ? 'Registrando...' : 'Registrar tercero'}
          </button>
        </form>
      )}
    </div>
  );

  return (
    <main className="h-screen overflow-hidden">
      {rootMode === 'payment' && (
        <section className="screen-shell screen-center">
          {electronicBillingEnabled && showBillingChoiceScreen && paymentStage === 'review' ? (
            <div className="glass-panel flex min-h-[calc(100vh-2rem)] max-w-6xl flex-col items-center justify-center text-center">
              <div className="absolute right-6 top-6 rounded-full bg-white/70 px-4 py-1.5 text-sm font-medium text-muted">
                {reviewCountdownSeconds > 0 ? `Cancelacion en: ${formatReviewCountdown(reviewCountdownSeconds)}` : 'Cancelando...'}
              </div>
              <p className="text-sm uppercase tracking-[0.22em] text-brand-700">Factura electronica</p>
              <h1 className="mt-4 max-w-3xl text-[clamp(2.4rem,6vw,5rem)] font-bold leading-[0.95] tracking-[-0.05em] text-ink">
                Desea factura electronica?
              </h1>
              <p className="mt-5 max-w-2xl text-lg leading-relaxed text-muted">
                La solicitud debe hacerse antes de iniciar el pago.
              </p>
              <div className="mt-8 grid w-full max-w-3xl gap-4 md:grid-cols-2">
                <button
                  type="button"
                  className="touch-button-primary w-full !min-h-[5.5rem] text-2xl"
                  onClick={() => handleBillingChoice(true)}
                >
                  Si
                </button>
                <button
                  type="button"
                  className="touch-button-secondary w-full !min-h-[5.5rem] text-2xl"
                  onClick={() => handleBillingChoice(false)}
                >
                  No
                </button>
              </div>
            </div>
          ) : electronicBillingEnabled && showBillingDetailsScreen && paymentStage === 'review' ? (
            <div className="glass-panel flex min-h-[calc(100vh-2rem)] max-w-6xl flex-col">
              <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div>
                  <h1 className="mt-2 text-[clamp(2rem,4vw,3.8rem)] font-bold leading-none tracking-[-0.05em] text-ink">
                    Datos de facturacion
                  </h1>
                  <p className="mt-2 max-w-2xl text-base leading-relaxed text-muted">
                    Valide o registre el tercero antes de continuar al pago.
                  </p>
                </div>
                <div className="rounded-full bg-white/70 px-4 py-1.5 text-sm font-medium text-muted">
                  {reviewCountdownSeconds > 0 ? `Cancelacion en: ${formatReviewCountdown(reviewCountdownSeconds)}` : 'Cancelando...'}
                </div>
              </div>

              <div className="grid flex-1 gap-4 lg:grid-cols-[0.8fr_1.2fr]">
                <div className="rounded-[1.75rem] border border-brand-100 bg-white/75 p-4">
                  <p className="text-sm uppercase tracking-[0.2em] text-brand-700">Cobro actual</p>
                  <div className="mt-3 grid gap-3">
                    <ReadOnlyField label={paymentDetails.identifierLabel} value={paymentDetails.identifierValue} />
                    <ReadOnlyField label="Monto adeudado" value={`$ ${currency.format(paymentDetails.amountDue)}`} />
                  </div>
                </div>

                <div className="rounded-[1.75rem] border border-brand-100 bg-white/75 p-4">
                  {billingDetailsForm}
                </div>
              </div>

              <div className="mt-4 grid gap-3 md:grid-cols-[auto_1fr]">
                <button
                  type="button"
                  className="touch-button-secondary w-full md:w-auto"
                  onClick={cancelElectronicBilling}
                  disabled={billingLoading}
                >
                  No facturar
                </button>
                <button
                  type="button"
                  className="touch-button-primary w-full"
                  onClick={continueToPaymentReview}
                  disabled={billingLoading || !billingCustomer?.exist}
                >
                  Continuar al pago
                </button>
              </div>
            </div>
          ) : (
            <div className="w-full max-w-6xl">
              <header className="mb-4 w-full text-center">
                <h1 className="mb-1 text-[clamp(1.8rem,3.5vw,3.5rem)] font-bold leading-none tracking-[-0.05em]">
                  Punto de pago Electronico
                </h1>
                <p className="text-base text-muted">{statusMessage}</p>
              </header>

              {paymentLoading && paymentStage === 'review' && (
                <div className="flex flex-col items-center justify-center gap-6 py-8">
                  <svg
                    className="h-24 w-24 animate-spin text-brand-500"
                    viewBox="0 0 24 24"
                    fill="none"
                    xmlns="http://www.w3.org/2000/svg"
                  >
                    <circle
                      className="opacity-20"
                      cx="12" cy="12" r="10"
                      stroke="currentColor"
                      strokeWidth="3"
                    />
                    <path
                      className="opacity-80"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                    />
                  </svg>
                  <div className="text-center">
                    <p className="text-2xl font-semibold text-ink">Procesando...</p>
                    <p className="mt-1 text-base text-muted">Por favor espere</p>
                  </div>
                </div>
              )}

              {paymentStage === 'idle' && (
                <div className="flex flex-col items-center justify-center py-2">
                  <img
                    src="/ImagenEscanear.jpeg"
                    alt="Escanee su QR"
                    className="h-96 w-auto rounded-4xl shadow-kiosk"
                  />
                </div>
              )}

              {paymentStage === 'scanning' && (
                <div className="glass-panel flex flex-col items-center justify-center gap-6 py-12">
                  <svg className="h-16 w-16 animate-spin text-brand-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  <div className="text-center">
                    <p className="text-2xl font-semibold text-ink">Validando QR...</p>
                    <p className="mt-1 text-base text-muted">Consultando con el servidor, por favor espere</p>
                  </div>
                </div>
              )}


              {!paymentLoading && paymentStage === 'review' && (
                <div className="glass-panel">
                  <div className="mb-4 flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
                    <div></div>
                    <div className="rounded-full bg-white/70 px-4 py-1.5 text-sm font-medium text-muted">
                      {reviewCountdownSeconds > 0 ? `Cancelacion en: ${formatReviewCountdown(reviewCountdownSeconds)}` : 'Cancelando...'}
                    </div>
                  </div>
                  {isMonthlyPayment ? (
                    <div className="grid gap-3 md:grid-cols-3">
                      <ReadOnlyField label="Placa" value={monthlySubscription?.plate || monthlyPlate || '-'} />
                      <ReadOnlyField label="Monto a cobrar" value={`$ ${currency.format(paymentDetails.amountDue)}`} />
                      <ReadOnlyField label="Fecha fin pronosticada" value={monthlyForecastedEndDate} />
                    </div>
                  ) : (
                    <div className="grid gap-3 md:grid-cols-2">
                      <ReadOnlyField label={paymentDetails.identifierLabel} value={paymentDetails.identifierValue} />
                      <ReadOnlyField label="Hora de entrada" value={paymentDetails.enteredAt} />
                      <ReadOnlyField label="Monto adeudado" value={`$ ${currency.format(paymentDetails.amountDue)}`} />
                    </div>
                  )}
                  {FIXED_PAYMENT_WARNINGS.length > 0 && (
                    <div className="mt-4 grid gap-3 lg:grid-cols-[1.1fr_0.9fr]">
                      <div className="rounded-[1.75rem] border border-alert-200 bg-alert-50 p-4">
                        <p className="text-sm uppercase tracking-[0.2em] text-alert-600">Antes de pagar</p>
                        <div className="mt-2 space-y-1 text-sm leading-relaxed text-alert-600">
                          {FIXED_PAYMENT_WARNINGS.map((warning) => (
                            <p key={warning}>{warning}</p>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                  {electronicBillingEnabled && electronicBillingRequested && (
                    <div className="mt-4 rounded-[1.75rem] border border-brand-100 bg-white/75 p-4">
                      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                        <div>
                          <p className="text-sm uppercase tracking-[0.2em] text-brand-700">Datos de facturacion listos</p>
                          <p className="mt-1 text-sm text-muted">Tercero: {billingCustomerLabel || billingDocument}</p>
                        </div>
                        <button
                          type="button"
                          className="touch-button-secondary !min-h-[2.75rem] !px-5 text-sm"
                          onClick={() => setShowBillingDetailsScreen(true)}
                        >
                          Editar datos
                        </button>
                      </div>
                    </div>
                  )}
                  <button
                    className="touch-button-primary mt-4 w-full"
                    onClick={() => void beginCollection()}
                    disabled={
                      (electronicBillingEnabled && showBillingChoiceScreen) ||
                      (electronicBillingEnabled && showBillingDetailsScreen) ||
                      paymentLoading ||
                      billingLoading ||
                      (electronicBillingEnabled && electronicBillingRequested && !billingCustomer?.exist) ||
                      !monthlySubscriptionValidated
                    }
                  >
                    Pagar
                  </button>
                </div>
              )}

              {paymentStage === 'collecting' && (
                <div className="glass-panel" onPointerDownCapture={handleCollectingInteraction}>
                  <div className="mb-4 flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
                    <div>
                      <span className="mb-1 inline-block text-xs uppercase tracking-[0.22em] text-brand-700">
                        Recepcion de efectivo
                      </span>
                      <h2 className="text-2xl font-semibold tracking-[-0.04em] md:text-3xl">
                        Introduzca billetes o monedas
                      </h2>
                    </div>
                    <div className="flex flex-col items-start gap-1.5 md:items-end">
                      <div className="rounded-full bg-white/70 px-3 py-1.5 text-sm text-muted">
                        ID: {paymentDetails.identifierValue}
                      </div>
                      <div className="rounded-full bg-white/70 px-3 py-1.5 text-sm font-medium text-muted">
                        {collectingCountdownSeconds > 0
                          ? `Cancelacion en: ${collectingCountdownSeconds} s`
                          : paymentDetails.insertedAmount > 0
                            ? 'Procesando devolucion...'
                            : 'Cancelando...'}
                      </div>
                    </div>
                  </div>

                  <div className="grid gap-3 lg:grid-cols-[1.1fr_0.9fr]">
                    <div className="grid gap-3 md:grid-cols-2">
                      <MetricCard
                        title="Ingresado"
                        value={`$ ${currency.format(paymentDetails.insertedAmount)}`}
                        accent="neutral"
                      />
                      <MetricCard
                        title={pendingAmount > 0 ? 'Faltante' : 'Listo'}
                        value={`$ ${currency.format(pendingAmount > 0 ? pendingAmount : 0)}`}
                        accent={pendingAmount > 0 ? 'danger' : 'success'}
                      />
                    </div>
                  </div>

                  {paymentDetails.insertedItems.length > 0 && (
                    <div className="mt-3 rounded-3xl border border-black/10 bg-white/70 p-3">
                      <p className="mb-2 text-xs uppercase tracking-[0.18em] text-muted">
                        Efectivo recibido
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {paymentDetails.insertedItems.map((item) => (
                          <span
                            key={item.denominationId}
                            className="rounded-full bg-brand-50 px-3 py-1.5 text-sm font-medium text-brand-700"
                          >
                            $ {currency.format(item.denominationId)} × {item.quantity}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {paymentStage === 'finalizing' && (
                <div className="glass-panel">
                  <div className="flex flex-col items-center gap-4 py-4">
                    {/* El servidor central es quien controla la salida — si no confirmo
                        el pago, NUNCA se le debe decir al cliente que puede retirar su
                        vehiculo, aunque el PPE ya haya cobrado y devuelto el cambio. */}
                    {paymentDetails.status === 'COMPLETED_WITH_WARNING' ? (
                      <>
                        <div className="flex h-28 w-28 items-center justify-center rounded-full bg-amber-50 border-4 border-amber-500 shadow-kiosk">
                          <svg
                            className="h-16 w-16 text-amber-500"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2.5"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <path d="M12 9v4m0 4h.01M10.29 3.86l-8.18 14.18A2 2 0 0 0 3.82 21h16.36a2 2 0 0 0 1.71-2.96L13.71 3.86a2 2 0 0 0-3.42 0z" />
                          </svg>
                        </div>
                        <div className="text-center">
                          <h2 className="text-3xl font-bold tracking-[-0.04em] text-amber-600">
                            Pago recibido — en verificacion
                          </h2>
                          <p className="mt-1 text-lg text-ink">
                            Su efectivo y cambio ya fueron procesados, pero el sistema central
                            aun no confirmo el pago. NO se dirija a la salida todavia —
                            espere confirmacion o contacte a un operador.
                          </p>
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="flex h-28 w-28 items-center justify-center rounded-full bg-ok-50 border-4 border-ok-500 shadow-kiosk">
                          <svg
                            className="h-16 w-16 text-ok-500"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2.5"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <path d="M20 6L9 17l-5-5" />
                          </svg>
                        </div>
                        <div className="text-center">
                          <h2 className="text-3xl font-bold tracking-[-0.04em] text-ok-600">
                            ¡Gracias por su pago!
                          </h2>
                          <p className="mt-1 text-lg text-ink">
                            {isMonthlyPayment
                              ? 'Su mensualidad fue registrada'
                              : 'Puede retirar su vehiculo del parqueadero'}
                          </p>
                        </div>
                      </>
                    )}

                    {/* Payment summary */}
                    <div className="grid w-full max-w-sm gap-3 sm:grid-cols-2">
                      <div className="rounded-3xl border border-black/10 bg-white/80 p-4 text-center">
                        <p className="text-xs uppercase tracking-[0.18em] text-muted">Pagado</p>
                        <p className="mt-1 text-xl font-semibold text-ink">
                          $ {currency.format(paymentDetails.insertedAmount)}
                        </p>
                      </div>
                      <div className="rounded-3xl border border-black/10 bg-white/80 p-4 text-center">
                        <p className="text-xs uppercase tracking-[0.18em] text-muted">Devuelta</p>
                        <p className="mt-1 text-xl font-semibold text-ink">
                          $ {currency.format(paymentDetails.changeAmount)}
                        </p>
                      </div>
                    </div>

                    {/* Countdown + print */}
                    <div className="flex flex-col items-center gap-3 pt-1">
                      <div className="rounded-full border border-black/10 bg-white/70 px-5 py-2 text-sm font-medium text-muted">
                        Volvera al inicio en {finalizingCountdownSeconds} s
                      </div>
                      <div className="flex gap-3">
                        <button
                          className="touch-button-primary px-8"
                          onClick={() => void handlePrintChoice(true)}
                          disabled={receiptPrinting}
                        >
                          {receiptPrinting ? 'Imprimiendo...' : 'Imprimir tiquete'}
                        </button>
                        <button
                          className="touch-button-secondary px-6"
                          onClick={() => void handlePrintChoice(false)}
                          disabled={receiptPrinting}
                        >
                          No imprimir
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </section>
      )}

      {rootMode === 'mode-select' && (
        <section className="screen-shell screen-center">
          <div className="glass-panel max-w-3xl">
            <h2 className="text-2xl font-semibold tracking-[-0.04em] md:text-3xl">Modo del equipo</h2>
            <p className="mt-2 text-sm text-muted">
              Desde aqui el personal puede cambiar entre cobro continuo, mantenimiento o acceso
              administrativo.
            </p>
            <div className="mt-5 grid gap-3 md:grid-cols-3">
              <button className="touch-button-primary" onClick={() => void goToPayment()}>
                Cobro
              </button>
              <button className="touch-button-secondary" onClick={() => void goToMaintenance()}>
                Mantenimiento
              </button>
              <button
                className="touch-button-secondary"
                onClick={() => setRootMode(adminSession ? 'admin-dashboard' : 'admin-login')}
              >
                Panel administrativo
              </button>
            </div>
          </div>
        </section>
      )}

      {rootMode === 'maintenance' && (
        <section className="screen-shell screen-center">
          <div className="glass-panel max-w-4xl text-center">
            <span
              className="mb-4 inline-block select-none cursor-default"
              onClick={unlock.onClick}
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-24 w-24 mx-auto animate-[spin_4s_linear_infinite]" fill="none" viewBox="0 0 24 24" stroke="#FF8533" strokeWidth={1.4}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 0 1 0 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 0 1 0-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28Z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
              </svg>
            </span>
            <h2 className="text-3xl font-semibold tracking-[-0.04em] md:text-5xl">
              Equipo temporalmente fuera de servicio
            </h2>
            <p className="mt-4 max-w-2xl mx-auto text-lg text-muted">
              Los cobros estan deshabilitados. Contacte al personal autorizado para cambiar el modo de operacion.
            </p>

          </div>
        </section>
      )}

      {rootMode === 'admin-login' && (
        <section className="screen-shell screen-center">
          <div className="glass-panel max-w-3xl">
            <span className="mb-3 inline-block text-xs uppercase tracking-[0.28em] text-brand-700">
              Panel Administrativo
            </span>
            <h2 className="text-2xl font-semibold tracking-[-0.04em] md:text-3xl">
              Login
            </h2>

            <form className="mt-5 space-y-3" onSubmit={(event) => void handleAdminLogin(event)}>
              <label className="block">
                <span className="mb-2 block text-sm font-medium text-muted">Correo</span>
                <input
                  className="touch-input cursor-pointer"
                  type="email"
                  readOnly
                  value={adminEmail}
                  placeholder="operador@empresa.com"
                  onClick={() => setKeyboardModal({
                    label: 'Correo',
                    initialValue: adminEmail,
                    type: 'email',
                    onAccept: (email) => {
                      setAdminEmail(email);
                      setKeyboardModal({
                        label: 'Contrasena',
                        initialValue: adminPassword,
                        type: 'password',
                        acceptLabel: 'Entrar',
                        onAccept: (password) => {
                          setAdminPassword(password);
                          setKeyboardModal(null);
                          void doAdminLogin(email, password);
                        },
                      });
                    },
                  })}
                />
              </label>

              <label className="block">
                <span className="mb-2 block text-sm font-medium text-muted">Contrasena</span>
                <input
                  className="touch-input cursor-pointer"
                  type="password"
                  readOnly
                  value={adminPassword}
                  placeholder="Ingrese su contrasena"
                  onClick={() => setKeyboardModal({
                    label: 'Contrasena',
                    initialValue: adminPassword,
                    type: 'password',
                    acceptLabel: 'Entrar',
                    onAccept: (password) => {
                      setAdminPassword(password);
                      setKeyboardModal(null);
                      void doAdminLogin(adminEmail, password);
                    },
                  })}
                />
              </label>

              {adminLoginError && (
                <div className="rounded-3xl border border-alert-200 bg-alert-50 px-4 py-3 text-sm text-alert-600">
                  {adminLoginError}
                </div>
              )}

              <div className="grid gap-3 md:grid-cols-2">
                <button className="touch-button-primary" type="submit" disabled={adminLoginLoading}>
                  {adminLoginLoading ? 'Validando...' : 'Entrar'}
                </button>
                <button
                  className="touch-button-secondary"
                  type="button"
                  onClick={() => setRootMode('mode-select')}
                >
                  Volver
                </button>
              </div>
            </form>
          </div>
        </section>
      )}

      {rootMode === 'admin-dashboard' && (
        <section className="h-screen overflow-hidden flex flex-col p-4">
          <div className="glass-panel-fill h-full max-w-7xl w-full mx-auto">

            {/* ---- HEADER ---- */}
            <div className="flex-shrink-0 mb-2 grid grid-cols-[1fr_auto_1fr] items-center gap-2">
              <div className="flex flex-wrap gap-2">
                {adminView !== 'home' && (
                  <button className="touch-button-secondary !min-h-[2.75rem] !px-3 text-xs" onClick={() => setAdminView('home')}>
                    Volver
                  </button>
                )}
                <button
                  className="touch-button-secondary !min-h-[2.75rem] !px-3 text-xs"
                  onClick={() => adminSession && void refreshAdminDashboard(adminSession.accessToken)}
                  disabled={adminDataLoading}
                >
                  {adminDataLoading ? 'Actualizando...' : 'Actualizar'}
                </button>
                <button
                  className="rounded-2xl border border-[#FF8533]/30 bg-[#FF8533]/10 px-3 text-xs font-semibold text-[#FF8533] transition-all active:scale-95 !min-h-[2.75rem] hover:bg-[#FF8533]/20"
                  onClick={exitToSelector}
                >
                  Salir
                </button>
              </div>
              <h2 className="text-2xl font-semibold tracking-[-0.04em] md:text-3xl text-center whitespace-nowrap">
                {adminView === 'cargar-dinero' && 'Cargar dinero'}
                {adminView === 'dispositivos' && 'Dispositivos'}
                {adminView === 'pagos-completados' && 'Pagos completados'}
                {adminView === 'cierres' && 'Cierres'}
              </h2>
              <div className="flex justify-end">
                <img src="/LogoCoins.png" alt="PPE Logo" className="h-9 w-auto" />
              </div>
            </div>

            {/* ---- BANNERS DE ERROR ---- */}
            {adminDataError && (
              <div className="flex-shrink-0 mb-2 rounded-3xl border border-alert-200 bg-alert-50 px-4 py-2 text-sm text-alert-600">
                {adminDataError}
              </div>
            )}
            {adminDashboard?.paymentsBlocked && (
              <div className="flex-shrink-0 mb-2 rounded-3xl border border-alert-200 bg-alert-50 px-4 py-2 text-sm text-alert-600">
                Cobros bloqueados: {adminDashboard.blockReason ?? 'sin motivo informado'}
              </div>
            )}

            {/* ---- VISTAS (flex-1 toma el resto de la altura) ---- */}
            <div className="flex-1 min-h-0 overflow-y-auto">

              {/* ---- HOME: 4 botones ---- */}
              {adminView === 'home' && (
                <div className="h-full grid gap-3 sm:grid-cols-2 content-center">
                  <button
                    className="touch-button-primary py-6 text-lg"
                    onClick={() => setAdminView('cargar-dinero')}
                  >
                    Cargar dinero
                  </button>
                  <button
                    className="touch-button-secondary py-6 text-lg"
                    onClick={() => setAdminView('dispositivos')}
                  >
                    Dispositivos
                  </button>
                  <button
                    className="touch-button-secondary py-6 text-lg"
                    onClick={() => setAdminView('pagos-completados')}
                  >
                    Pagos completados
                  </button>
                  <button
                    className="touch-button-secondary py-6 text-lg"
                    onClick={() => setAdminView('cierres')}
                  >
                    Cierres
                  </button>
                </div>
              )}

              {/* ---- CARGAR DINERO ---- */}
              {adminView === 'cargar-dinero' && (
                <div className="space-y-2">
                  {adminDispenserSlots.length === 0 && (
                    <p className="text-sm text-muted">Sin datos de slots. Actualice el dashboard.</p>
                  )}
                  {adminDispenserSlots.map((slot) => {
                    const label = SLOT_LABELS[slot.slotKey] ?? slot.slotKey;
                    const isOpen = cargarSection === slot.slotKey;
                    const isActionOpen = slotActionKey === slot.slotKey;
                    const total = slot.denominationId ? slot.quantity * slot.denominationId : 0;
                    return (
                      <AccordionSection
                        key={slot.slotKey}
                        title={label}
                        subtitle={`${slot.denominationId ? `$${currency.format(slot.denominationId)}` : 'Sin denom.'} · ${slot.quantity} und · $${currency.format(total)}`}
                        isOpen={isOpen}
                        onToggle={() => { setCargarSection(isOpen ? null : slot.slotKey); setSlotActionKey(null); }}
                      >
                        <div className="rounded-2xl border border-black/5 bg-white p-3 space-y-2">
                          <div className="grid grid-cols-3 gap-1.5">
                            <button
                              className="touch-button-primary !min-h-[2.75rem] text-xs"
                              disabled={!slot.denominationId || isActionOpen}
                              onClick={() => { setSlotActionKey(slot.slotKey); setSlotActionDir('load'); setSlotActionQty(1); setSlotActionReason(''); }}
                            >+ Cargar</button>
                            <button
                              className="touch-button-secondary !min-h-[2.75rem] text-xs"
                              disabled={!slot.denominationId || isActionOpen}
                              onClick={() => { setSlotActionKey(slot.slotKey); setSlotActionDir('unload'); setSlotActionQty(1); setSlotActionReason(''); }}
                            >- Retirar</button>
                            <button
                              className="touch-button-secondary !min-h-[2.75rem] text-xs"
                              onClick={() => { setDenomModalSlot(slot); setDenomModalValue(slot.denominationId); }}
                            >Cambiar</button>
                          </div>
                          {isActionOpen && (
                            <div className="space-y-2 border-t border-black/5 pt-2">
                              <p className="text-xs font-medium text-muted">
                                {slotActionDir === 'load' ? 'Cargando en' : 'Retirando de'} {label}
                                {slot.denominationId ? ` · $${currency.format(slot.denominationId)} c/u` : ''}
                              </p>
                              <div className="grid grid-cols-2 gap-2">
                                <label className="block">
                                  <span className="mb-1 block text-xs font-medium text-muted">Cantidad</span>
                                  <input className="touch-input !min-h-[2.75rem] cursor-pointer" readOnly value={slotActionQty} onClick={() => kb('Cantidad', String(slotActionQty), 'numeric', (v) => setSlotActionQty(Math.max(1, Number(v) || 1)))} />
                                </label>
                                <label className="block">
                                  <span className="mb-1 block text-xs font-medium text-muted">Motivo</span>
                                  <input className="touch-input !min-h-[2.75rem] cursor-pointer" readOnly value={slotActionReason} placeholder="Ej. carga inicial" onClick={() => kb('Motivo', slotActionReason, 'text', setSlotActionReason)} />
                                </label>
                              </div>
                              <div className="flex gap-2">
                                <button className="touch-button-primary flex-1 !min-h-[2.75rem]" onClick={() => void handleSlotCashAction()} disabled={slotActionLoading}>
                                  {slotActionLoading ? 'Guardando...' : 'Confirmar'}
                                </button>
                                <button className="touch-button-secondary flex-1 !min-h-[2.75rem]" onClick={() => setSlotActionKey(null)} disabled={slotActionLoading}>
                                  Cancelar
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      </AccordionSection>
                    );
                  })}
                  <AccordionSection
                    title="Movimientos recientes"
                    isOpen={cargarSection === 'movimientos'}
                    onToggle={() => { setCargarSection(cargarSection === 'movimientos' ? null : 'movimientos'); setSlotActionKey(null); }}
                  >
                    <div className="space-y-1.5">
                      {recentMovementRows.length === 0 && <p className="text-sm text-muted px-2">Todavia no hay movimientos recientes.</p>}
                      {recentMovementRows.map(([name, detail, total]) => (
                        <div key={name} className="grid gap-2 rounded-2xl border border-black/5 bg-white/70 px-3 py-2 md:grid-cols-[1.1fr_1fr_auto]">
                          <span className="text-sm font-medium text-ink">{name}</span>
                          <span className="text-sm text-muted">{detail}</span>
                          <span className="text-sm font-semibold text-brand-700">{total}</span>
                        </div>
                      ))}
                    </div>
                  </AccordionSection>
                  <div className="rounded-2xl bg-brand-50 border border-brand-100 px-4 py-2 flex items-center justify-between">
                    <span className="text-xs text-brand-700">Cambio disponible total</span>
                    <span className="font-semibold text-sm text-brand-700">${currency.format(changeAvailableTotal)}</span>
                  </div>
                </div>
              )}

              {/* ---- DISPOSITIVOS ---- */}
              {adminView === 'dispositivos' && (
                <div className="space-y-2">
                  <AccordionSection
                    title="Estado de dispositivos"
                    isOpen={dispositivosSection === 'estado'}
                    onToggle={() => setDispositivosSection((s) => (s === 'estado' ? '' : 'estado'))}
                  >
                    <div className="space-y-1.5">
                      {deviceRows.length === 0 && <p className="text-sm text-muted">Sin dispositivos registrados.</p>}
                      {deviceRows.map(([name, detail, status]) => (
                        <div key={name} className="grid gap-2 rounded-2xl border border-black/5 bg-white/70 px-3 py-2 md:grid-cols-[1.1fr_1fr_auto]">
                          <span className="text-sm font-medium text-ink">{name}</span>
                          <span className="text-sm text-muted">{detail}</span>
                          <span className={`text-sm font-semibold ${status === 'Con alerta' ? 'text-alert-600' : status === 'OK' ? 'text-ok-600' : 'text-muted'}`}>{status}</span>
                        </div>
                      ))}
                    </div>
                  </AccordionSection>
                  <AccordionSection
                    title="Prueba de receptores"
                    subtitle={collectorTestStatus.enabled ? 'Activos — esperando inserciones' : 'Apagados'}
                    isOpen={dispositivosSection === 'prueba'}
                    onToggle={() => setDispositivosSection((s) => (s === 'prueba' ? '' : 'prueba'))}
                  >
                    <div className="rounded-2xl border border-black/5 bg-white p-3 space-y-2">
                      <p className="text-xs text-muted">Prueba entrada real de billetes y monedas sin crear una transaccion de pago.</p>
                      <div className="flex flex-wrap gap-2">
                        <StatusPill label={collectorTestStatus.enabled ? 'Activos' : 'Apagados'} tone={collectorTestStatus.enabled ? 'success' : 'danger'} />
                        <button className="touch-button-primary !min-h-[2.75rem] !px-3 text-xs" onClick={() => void handleCollectorTestToggle(true)} disabled={collectorTestLoading || collectorTestStatus.enabled || !adminSession}>
                          {collectorTestLoading && !collectorTestStatus.enabled ? 'Activando...' : 'Activar'}
                        </button>
                        <button className="touch-button-secondary !min-h-[2.75rem] !px-3 text-xs" onClick={() => void handleCollectorTestToggle(false)} disabled={collectorTestLoading || !collectorTestStatus.enabled || !adminSession}>
                          {collectorTestLoading && collectorTestStatus.enabled ? 'Apagando...' : 'Apagar'}
                        </button>
                      </div>
                      <div className="grid gap-2 sm:grid-cols-3">
                        <MetricCard title="Eventos" value={String(collectorSamples.length)} accent="neutral" />
                        <MetricCard title="Total" value={`$ ${currency.format(collectorTestTotal)}`} accent="success" />
                        <MetricCard title="Ultimo" value={collectorSamples[0] ? `$ ${currency.format(collectorSamples[0].amount)}` : 'Sin dato'} accent="neutral" />
                      </div>
                      <div className="rounded-xl border border-black/5 bg-gray-50 p-2">
                        <div className="mb-1 flex items-center justify-between">
                          <span className="text-xs font-medium uppercase tracking-[0.14em] text-muted">Collector live</span>
                          <span className="text-xs text-muted">{collectorTestStatus.enabled ? 'Esperando...' : 'Active los receptores'}</span>
                        </div>
                        <div className="max-h-24 space-y-1 overflow-y-auto">
                          {collectorSamples.length === 0 && <p className="text-xs text-muted">Inserte dinero para ver lecturas aqui.</p>}
                          {collectorSamples.map((sample, index) => (
                            <div key={`${sample.receivedAt}-${sample.source}-${index}`} className="grid gap-2 rounded-xl border border-black/5 bg-white px-3 py-1.5 md:grid-cols-[auto_1fr_auto]">
                              <span className="text-xs font-semibold text-ink">{sample.kind === 'COIN' ? 'Moneda' : 'Billete'}</span>
                              <span className="text-xs text-muted">{`$${currency.format(sample.amount)} · ${formatBackendDate(sample.receivedAt)}`}</span>
                              <span className="text-xs font-medium text-brand-700">{sample.source}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </AccordionSection>
                  <AccordionSection
                    title="Expulsar unidades"
                    isOpen={dispositivosSection === 'expulsar'}
                    onToggle={() => setDispositivosSection((s) => (s === 'expulsar' ? '' : 'expulsar'))}
                  >
                    <div className="grid gap-2 sm:grid-cols-2">
                      {adminDispenserSlots.length === 0 && <p className="text-sm text-muted sm:col-span-2">Sin datos de slots.</p>}
                      {adminDispenserSlots.map((slot) => (
                        <div key={slot.slotKey} className="flex items-center justify-between rounded-2xl border border-black/5 bg-white p-2.5">
                          <div>
                            <p className="font-medium text-sm">{SLOT_LABELS[slot.slotKey] ?? slot.slotKey}</p>
                            <p className="text-xs text-muted">{slot.quantity} und</p>
                          </div>
                          <button className="touch-button-secondary !min-h-[2.75rem] !px-3 text-xs" disabled={!slot.denominationId || slot.quantity < 1 || slotEjectLoadingKey === slot.slotKey} onClick={() => void handleSlotEject(slot.slotKey)}>
                            {slotEjectLoadingKey === slot.slotKey ? 'Expulsando...' : 'Expulsar 1'}
                          </button>
                        </div>
                      ))}
                    </div>
                  </AccordionSection>
                </div>
              )}

              {/* ---- PAGOS COMPLETADOS ---- */}
              {adminView === 'pagos-completados' && (() => {
                const totalPages = Math.max(1, Math.ceil(adminCompletedPayments.length / PAGOS_PER_PAGE));
                const page = Math.min(pagosPage, totalPages - 1);
                const pageItems = adminCompletedPayments.slice(page * PAGOS_PER_PAGE, page * PAGOS_PER_PAGE + PAGOS_PER_PAGE);
                return (
                  <div className="flex flex-col gap-2">
                    <div className="flex items-center justify-between">
                      {/* <h3 className="text-xl font-semibold tracking-[-0.04em]">Pagos completados hoy</h3> */}
                      {adminCompletedPayments.length > 0 && (
                        <span className="text-xs text-muted">
                          {page * PAGOS_PER_PAGE + 1}–{Math.min((page + 1) * PAGOS_PER_PAGE, adminCompletedPayments.length)} de {adminCompletedPayments.length}
                        </span>
                      )}
                    </div>
                    <div className="space-y-2">
                      {adminCompletedPayments.length === 0 && (
                        <p className="text-sm text-muted">Todavia no hay pagos completados hoy.</p>
                      )}
                      {pageItems.map((payment) => (
                        <div key={payment.id} className="flex flex-wrap items-center gap-3 rounded-2xl border border-black/5 bg-white/80 px-4 py-3">
                          <span className="min-w-0 flex-1 truncate font-medium text-ink text-sm">
                            {payment.identificationCode ?? payment.qrCode ?? payment.id}
                          </span>
                          <span className="whitespace-nowrap text-sm text-muted">
                            {formatBackendDate(payment.completedAt ?? payment.updatedAt)}
                          </span>
                          <span className="whitespace-nowrap font-semibold text-brand-700">
                            ${currency.format(payment.targetAmount)}
                          </span>
                          <button className="touch-button-primary !min-h-[2.5rem] !px-4 text-sm whitespace-nowrap" onClick={() => void handlePaymentPrint(payment.id)} disabled={paymentPrintLoadingId === payment.id}>
                            {paymentPrintLoadingId === payment.id ? 'Imprimiendo...' : 'Imprimir'}
                          </button>
                          <button className="touch-button-secondary !min-h-[2.5rem] !px-4 text-sm whitespace-nowrap" onClick={() => setPaymentDetailModal(payment)}>
                            Ver detalles
                          </button>
                        </div>
                      ))}
                    </div>
                    {totalPages > 1 && (
                      <div className="flex items-center justify-between gap-3 pt-1">
                        <button
                          className="touch-button-secondary flex-1 !min-h-[2.75rem]"
                          onClick={() => setPagosPage((p) => Math.max(0, p - 1))}
                          disabled={page === 0}
                        >
                          Anterior
                        </button>
                        <span className="text-sm font-medium text-muted whitespace-nowrap">
                          {page + 1} / {totalPages}
                        </span>
                        <button
                          className="touch-button-secondary flex-1 !min-h-[2.75rem]"
                          onClick={() => setPagosPage((p) => Math.min(totalPages - 1, p + 1))}
                          disabled={page === totalPages - 1}
                        >
                          Siguiente
                        </button>
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* ---- CIERRES ---- */}
              {adminView === 'cierres' && (
                <div className="space-y-2">
                  <div className="grid gap-3 sm:grid-cols-2 mb-1">
                    <MetricCard title="Recaudo del dia" value={`$ ${currency.format(collectedTodayTotal)}`} accent="success" />
                    <MetricCard title="Transacciones" value={String(adminDashboard?.transactionCount ?? 0)} accent="neutral" />
                  </div>
                  <AccordionSection
                    title="Ejecutar cierre"
                    isOpen={cierresSection === 'ejecutar'}
                    onToggle={() => setCierresSection((s) => (s === 'ejecutar' ? '' : 'ejecutar'))}
                  >
                    <div className="rounded-2xl border border-black/5 bg-white p-3 space-y-2">
                      <p className="text-xs text-muted">El cierre toma el recaudo acumulado desde el ultimo cierre, bloquea cobros mientras se ejecuta y deja la traza lista para la tirilla.</p>
                      <div className="grid gap-2 sm:grid-cols-2">
                        <button className={`touch-button-secondary !min-h-[2.5rem] ${closeoutType === 'PARTIAL' ? 'ring-2 ring-brand-300' : ''}`} onClick={() => setCloseoutType('PARTIAL')} disabled={closeoutLoading || !adminSession}>
                          Cierre parcial
                        </button>
                        <button className={`touch-button-secondary !min-h-[2.5rem] ${closeoutType === 'TOTAL' ? 'ring-2 ring-brand-300' : ''}`} onClick={() => setCloseoutType('TOTAL')} disabled={closeoutLoading || !adminSession}>
                          Cierre total
                        </button>
                      </div>
                      <p className="text-xs text-muted">
                        {closeoutType === 'PARTIAL'
                          ? 'El cierre parcial genera un corte informativo sin reiniciar el ciclo operativo.'
                          : 'El cierre total genera el corte definitivo del ciclo y reinicia el acumulado para el siguiente periodo.'}
                      </p>
                      <input className="touch-input cursor-pointer" readOnly value={closeoutNotes} placeholder="Notas opcionales del cierre" onClick={() => kb('Notas del cierre', closeoutNotes, 'text', setCloseoutNotes)} />
                      <button className="touch-button-primary w-full" onClick={() => void handleCloseout(closeoutType)} disabled={closeoutLoading || !adminSession}>
                        {closeoutLoading ? 'Ejecutando cierre...' : closeoutType === 'PARTIAL' ? 'Ejecutar cierre parcial' : 'Ejecutar cierre total'}
                      </button>
                      {adminDashboard?.lastCloseout && (
                        <div className="flex flex-wrap items-center gap-2 justify-between border-t border-black/5 pt-2">
                          <p className="text-xs text-muted">
                            Ultimo: {formatBackendDate(adminDashboard.lastCloseout.closedAt)} · {adminDashboard.lastCloseout.closeoutType === 'PARTIAL' ? 'Parcial' : 'Total'} · ${currency.format(adminDashboard.lastCloseout.totalCollected)}
                          </p>
                          <button className="touch-button-secondary !min-h-[2.75rem] !px-3 text-xs whitespace-nowrap" onClick={() => void handleCloseoutPrint(adminDashboard.lastCloseout!.id)} disabled={closeoutPrintLoadingId === adminDashboard.lastCloseout.id}>
                            {closeoutPrintLoadingId === adminDashboard.lastCloseout.id ? 'Imprimiendo...' : 'Reimprimir'}
                          </button>
                        </div>
                      )}
                    </div>
                  </AccordionSection>
                  <AccordionSection
                    title="Historial de cierres"
                    isOpen={cierresSection === 'historial'}
                    onToggle={() => setCierresSection((s) => (s === 'historial' ? '' : 'historial'))}
                  >
                    <div className="space-y-2">
                      <div className="grid gap-2 sm:grid-cols-2">
                        <label className="block">
                          <span className="mb-1 block text-xs font-medium uppercase tracking-[0.18em] text-muted">Desde</span>
                          <input type="date" className="touch-input !min-h-[2.5rem]" value={closeoutFilterFrom} onChange={(e) => setCloseoutFilterFrom(e.target.value)} />
                        </label>
                        <label className="block">
                          <span className="mb-1 block text-xs font-medium uppercase tracking-[0.18em] text-muted">Hasta</span>
                          <input type="date" className="touch-input !min-h-[2.5rem]" value={closeoutFilterTo} onChange={(e) => setCloseoutFilterTo(e.target.value)} />
                        </label>
                      </div>
                      {(closeoutFilterFrom || closeoutFilterTo) && (
                        <button className="touch-button-secondary !min-h-[2.75rem] !px-3 text-xs" onClick={() => { setCloseoutFilterFrom(''); setCloseoutFilterTo(''); }}>
                          Limpiar filtro
                        </button>
                      )}
                      <div className="max-h-52 overflow-y-auto space-y-2">
                        {filteredCloseouts.length === 0 && (
                          <p className="text-sm text-muted">{closeoutFilterFrom || closeoutFilterTo ? 'No hay cierres para el rango seleccionado.' : 'Todavia no hay cierres registrados.'}</p>
                        )}
                        {filteredCloseouts.map((closeout) => (
                          <div key={closeout.id} className="flex flex-wrap items-center gap-2 rounded-2xl border border-black/5 bg-white/80 px-3 py-2">
                            <div className="min-w-0 flex-1">
                              <p className="text-xs font-medium text-ink">{formatBackendDate(closeout.closedAt)}</p>
                              <p className="text-xs text-muted">{closeout.closedBy} · {closeout.transactionCount} trx · {closeout.closeoutType === 'PARTIAL' ? 'Parcial' : 'Total'}</p>
                            </div>
                            <span className="whitespace-nowrap text-sm font-semibold text-brand-700">${currency.format(closeout.totalCollected)}</span>
                            <button className="touch-button-secondary !min-h-[2.75rem] !px-3 text-xs whitespace-nowrap" onClick={() => void handleCloseoutPrint(closeout.id)} disabled={closeoutPrintLoadingId === closeout.id}>
                              {closeoutPrintLoadingId === closeout.id ? 'Imprimiendo...' : 'Reimprimir'}
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  </AccordionSection>
                </div>
              )}

            </div>{/* fin flex-1 min-h-0 vistas */}
          </div>
        </section>
      )
      }

      {/* ---- MODAL: Cambiar denominacion ---- */}
      {
        denomModalSlot && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
            <div className="w-full max-w-sm rounded-4xl border border-black/10 bg-white p-6 shadow-kiosk">
              <h3 className="mb-1 text-xl font-semibold tracking-[-0.03em]">Cambiar denominacion</h3>
              <p className="mb-4 text-sm text-muted">{SLOT_LABELS[denomModalSlot.slotKey] ?? denomModalSlot.slotKey}</p>
              {denomModalSlot.quantity > 0 && (
                <p className="mb-4 rounded-2xl border border-alert-200 bg-alert-50 px-3 py-2 text-xs text-alert-600">
                  Para cambiar la denominacion, primero vacie este slot (cantidad = 0).
                </p>
              )}
              <select
                className="touch-input !min-h-[3rem]"
                value={denomModalValue ?? ''}
                disabled={slotDenomLoading === denomModalSlot.slotKey || denomModalSlot.quantity > 0}
                onChange={(e) => setDenomModalValue(e.target.value ? Number(e.target.value) : null)}
              >
                <option value="">Sin asignar</option>
                {adminDenominations
                  .filter((d) => d.kind === (denomModalSlot.slotKey.startsWith('coin') ? 'COIN' : 'BILL'))
                  .map((d) => (
                    <option key={d.id} value={d.id}>
                      ${currency.format(d.id)}
                    </option>
                  ))}
              </select>
              <div className="mt-4 grid grid-cols-2 gap-3">
                <button
                  className="touch-button-primary !min-h-[3rem]"
                  disabled={slotDenomLoading === denomModalSlot.slotKey || denomModalSlot.quantity > 0}
                  onClick={async () => {
                    await handleSlotDenomChange(denomModalSlot.slotKey, denomModalValue);
                    setDenomModalSlot(null);
                  }}
                >
                  {slotDenomLoading === denomModalSlot.slotKey ? 'Guardando...' : 'Confirmar'}
                </button>
                <button
                  className="touch-button-secondary !min-h-[3rem]"
                  onClick={() => setDenomModalSlot(null)}
                >
                  Cancelar
                </button>
              </div>
            </div>
          </div>
        )
      }

      {/* ---- MODAL: Detalle de pago ---- */}
      {
        paymentDetailModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
            <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-4xl border border-black/10 bg-white p-6 shadow-kiosk">
              <div className="mb-4 flex items-start justify-between gap-4">
                <div>
                  <h3 className="text-xl font-semibold tracking-[-0.03em]">Detalle del pago</h3>
                  <p className="mt-1 truncate text-sm text-muted">{paymentDetailModal.id}</p>
                </div>
                <button
                  className="touch-button-secondary !min-h-[2.5rem] shrink-0 !px-4 text-sm"
                  onClick={() => setPaymentDetailModal(null)}
                >
                  Cerrar
                </button>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <ReadOnlyField label="Estado" value={paymentDetailModal.status} />
                <ReadOnlyField label="Sincronizacion" value={paymentDetailModal.serverSyncStatus} />
                <ReadOnlyField label="Monto objetivo" value={`$${currency.format(paymentDetailModal.targetAmount)}`} />
                <ReadOnlyField label="Monto ingresado" value={`$${currency.format(paymentDetailModal.insertedAmount)}`} />
                <ReadOnlyField label="Cambio devuelto" value={`$${currency.format(paymentDetailModal.changeAmount)}`} />
                {paymentDetailModal.identificationCode && (
                  <ReadOnlyField
                    label={paymentDetailModal.identificationType ?? 'Identificacion'}
                    value={paymentDetailModal.identificationCode}
                  />
                )}
                {paymentDetailModal.qrCode && (
                  <ReadOnlyField label="QR" value={paymentDetailModal.qrCode} />
                )}
                {paymentDetailModal.vehiclePlate && (
                  <ReadOnlyField label="Placa" value={paymentDetailModal.vehiclePlate} />
                )}
                {paymentDetailModal.concept && (
                  <ReadOnlyField label="Concepto" value={paymentDetailModal.concept} />
                )}
                <ReadOnlyField label="Inicio" value={formatBackendDate(paymentDetailModal.startedAt)} />
                {paymentDetailModal.completedAt && (
                  <ReadOnlyField label="Completado" value={formatBackendDate(paymentDetailModal.completedAt)} />
                )}
                {paymentDetailModal.failureReason && (
                  <ReadOnlyField label="Motivo de falla" value={paymentDetailModal.failureReason} />
                )}
              </div>
              <div className="mt-6 grid grid-cols-2 gap-3">
                <button
                  className="touch-button-primary !min-h-[3rem]"
                  onClick={() => void handlePaymentPrint(paymentDetailModal.id)}
                  disabled={paymentPrintLoadingId === paymentDetailModal.id}
                >
                  {paymentPrintLoadingId === paymentDetailModal.id ? 'Imprimiendo...' : 'Imprimir comprobante'}
                </button>
                <button
                  className="touch-button-secondary !min-h-[3rem]"
                  onClick={() => setPaymentDetailModal(null)}
                >
                  Cerrar
                </button>
              </div>
            </div>
          </div>
        )
      }
      {rootMode !== 'admin-dashboard' && (
        <span
          className="fixed top-4 left-4 z-40 select-none cursor-default"
          onClick={unlock.onClick}
        >
          <img src="/LogoCoins.png" alt="PPE Logo" className="h-14 w-auto" />
        </span>
      )}

      {SIMULATE && (
        <SimPanel paymentStage={paymentStage} paymentDetails={paymentDetails} />
      )}

      {keyboardModal && (
        <KeyboardModal
          key={keyboardModal.label}
          label={keyboardModal.label}
          initialValue={keyboardModal.initialValue}
          type={keyboardModal.type}
          acceptLabel={keyboardModal.acceptLabel}
          onAccept={keyboardModal.onAccept}
          onCancel={() => setKeyboardModal(null)}
        />
      )}

      {cancelNotice && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60">
          <div className="glass-panel max-w-md mx-4 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-alert-50 border-4 border-alert-200 mx-auto mb-4">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 text-alert-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
              </svg>
            </div>
            <p className="text-xl font-semibold text-ink">{cancelNotice}</p>
            <div className="mt-5 h-1.5 bg-black/10 rounded-full overflow-hidden">
              <div key={cancelNotice} className="h-full bg-brand-500 rounded-full cancel-notice-bar" />
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

function parseEventPayload(event: Event): Record<string, unknown> | null {
  if (!(event instanceof MessageEvent) || typeof event.data !== 'string') {
    return null;
  }

  try {
    return JSON.parse(event.data) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function resolveKioskMaintenanceReason(
  payload: { updatedBy?: unknown; blockReason?: unknown } | null | undefined,
): string | null {
  if (!payload) {
    return null;
  }

  if (asString(payload.updatedBy) === SERVER_LINK_DISCONNECTED_BY) {
    return SERVER_LINK_MAINTENANCE_REASON;
  }

  return asString(payload.blockReason) || null;
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function asNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function msToSecondsOr(ms: number | undefined, fallbackSeconds: number): number {
  return typeof ms === 'number' && Number.isFinite(ms) && ms > 0
    ? Math.round(ms / 1000)
    : fallbackSeconds;
}

function parseMonthlySubscription(value: unknown): MonthlySubscriptionDetails | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const record = value as MonthlySubscriptionDetails;
  return record.type === 'MONTHLY_SUBSCRIPTION' ? record : null;
}

function parseAcceptancePolicy(value: unknown): AcceptancePolicy | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const record = value as Record<string, unknown>;
  const acceptedBillDenominations = Array.isArray(record.acceptedBillDenominations)
    ? record.acceptedBillDenominations.filter(
      (item): item is number => typeof item === 'number' && Number.isFinite(item),
    )
    : [];
  const dispensableDenominations = Array.isArray(record.dispensableDenominations)
    ? record.dispensableDenominations.filter(
      (item): item is number => typeof item === 'number' && Number.isFinite(item),
    )
    : [];

  return {
    pendingAmount: asNumber(record.pendingAmount),
    acceptedBillDenominations,
    maxAcceptedBill: asNumber(record.maxAcceptedBill),
    message: asString(record.message),
    dispensableDenominations,
  };
}

function formatBackendDate(value: string): string {
  if (!value) {
    return '';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat('es-CO', {
    timeZone: BOGOTA_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  }).format(date);
}

function readStoredAdminSession(): AdminSession | null {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(ADMIN_SESSION_KEY);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as AdminSession;
    if (!parsed.accessToken || !parsed.email) {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

function persistAdminSession(session: AdminSession) {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.setItem(ADMIN_SESSION_KEY, JSON.stringify(session));
}

function formatCurrentBogotaDateTime(): string {
  return new Intl.DateTimeFormat('es-CO', {
    timeZone: BOGOTA_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  }).format(new Date());
}

function clearStoredAdminSession() {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.removeItem(ADMIN_SESSION_KEY);
}

function AccordionSection({
  title,
  subtitle,
  isOpen,
  onToggle,
  children,
}: {
  title: string;
  subtitle?: string;
  isOpen: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div>
      <button
        className={`w-full flex items-center justify-between rounded-2xl border px-4 py-3 text-left transition-colors ${isOpen ? 'bg-brand-50 border-brand-300' : 'bg-white/70 border-black/5 hover:bg-white/90'
          }`}
        onClick={onToggle}
      >
        <div>
          <span className={`block font-semibold text-sm ${isOpen ? 'text-brand-700' : 'text-ink'}`}>{title}</span>
          {subtitle && <span className="block text-xs text-muted mt-0.5">{subtitle}</span>}
        </div>
        <span className={`ml-3 text-xs flex-shrink-0 ${isOpen ? 'text-brand-500' : 'text-muted'}`}>{isOpen ? '▲' : '▼'}</span>
      </button>
      {isOpen && <div className="mt-2">{children}</div>}
    </div>
  );
}

function ReadOnlyField({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric-box">
      <span className="mb-1 block text-xs text-muted">{label}</span>
      <strong className="text-base font-semibold tracking-[-0.03em]">{value}</strong>
    </div>
  );
}


function MetricCard({
  title,
  value,
  accent,
}: {
  title: string;
  value: string;
  accent: 'neutral' | 'danger' | 'success';
}) {
  const accentClass =
    accent === 'danger'
      ? 'text-alert-500'
      : accent === 'success'
        ? 'text-ok-500'
        : 'text-ink';

  return (
    <article className="metric-box">
      <span className="mb-1 block text-xs uppercase tracking-[0.14em] text-muted">{title}</span>
      <strong className={`text-[clamp(1.3rem,2vw,1.8rem)] font-semibold tracking-[-0.04em] ${accentClass}`}>
        {value}
      </strong>
    </article>
  );
}

function StatusPill({
  label,
  tone,
}: {
  label: string;
  tone: 'success' | 'danger';
}) {
  const className =
    tone === 'success'
      ? 'bg-ok-50 text-ok-600 border-ok-200'
      : 'bg-alert-50 text-alert-600 border-alert-200';

  return (
    <span className={`inline-flex items-center rounded-full border px-4 py-2 text-sm font-medium ${className}`}>
      {label}
    </span>
  );
}
