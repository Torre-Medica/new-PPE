export type RootMode = 'payment' | 'mode-select' | 'maintenance' | 'admin-login' | 'admin-dashboard';

export interface DispenserSlot {
  slotKey: 'bill1' | 'bill2' | 'coin1' | 'coin2';
  denominationId: number | null;
  label: string;
  isActive: boolean;
  quantity: number;
}
export type PaymentStage = 'idle' | 'scanning' | 'review' | 'collecting' | 'finalizing';

export interface MonthlySubscriptionDetails {
  type?: 'MONTHLY_SUBSCRIPTION';
  stage?: 'CUSTOMER_LOOKUP' | 'AWAITING_PLATE' | 'VALIDATED';
  scannedCode?: string;
  identificationCode?: string;
  paddedFromEightDigits?: boolean;
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
  validationError?: string;
  validatedAt?: string;
  customer?: {
    customerName?: string;
    schedulingZone?: string;
    schedulingZoneId?: number;
    schedulingStartDatetime?: string | null;
    schedulingEndDatetime?: string | null;
    plate1?: string;
    plate2?: string;
    plate3?: string;
    [key: string]: unknown;
  };
  validationDetail?: {
    lastMonthlySubscriptionStartDatetime?: string;
    lastMonthlySubscriptionEndDatetime?: string;
    lastMonthlySubscriptionVehicleKind?: string;
    requestedMonthlySubscriptionStartDatetime?: string;
    requestedMonthlySubscriptionEndDatetime?: string;
    requestedMonthlySubscriptionVehicleKind?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface InsertedCashItem {
  denominationId: number;
  quantity: number;
}

export interface PaymentDetails {
  identifierLabel: 'UUID' | 'Cedula';
  paymentSessionId?: string;
  sessionType?: 'VISITOR' | 'MONTHLY_SUBSCRIPTION';
  identifierValue: string;
  amountDue: number;
  enteredAt: string;
  insertedAmount: number;
  insertedItems: InsertedCashItem[];
  changeAmount: number;
  concept?: string;
  vehiclePlate?: string | null;
  status?: string;
  acceptancePolicy?: AcceptancePolicy | null;
  monthlySubscription?: MonthlySubscriptionDetails | null;
}

export interface KioskStateSummary {
  id: number;
  mode: 'PAYMENT' | 'MAINTENANCE';
  paymentsBlocked: boolean;
  blockReason: string | null;
  updatedBy: string;
  features?: {
    electronicBillingEnabled?: boolean;
    monthlySubscriptionsEnabled?: boolean;
  };
  timeouts?: {
    validatingMs?: number;
    reviewMs?: number;
    cashMs?: number;
    billingDetailsMs?: number;
    monthlySubscriptionMs?: number;
    finalizingMs?: number;
  };
}

export interface ElectronicBillingIdentificationType {
  id: number;
  identification: string;
}

export interface ElectronicBillingFiscalResponsibility {
  id: number;
  code: string;
  description: string;
}

export interface ElectronicBillingCity {
  id: number;
  cityName: string;
  StateName: string;
}

export interface ElectronicBillingCatalogs {
  identificationTypes: ElectronicBillingIdentificationType[];
  fiscalResponsibilities: ElectronicBillingFiscalResponsibility[];
  cities: ElectronicBillingCity[];
}

export interface ElectronicBillingCustomerSearch {
  exist: boolean;
  data: {
    first_name?: string;
    last_name?: string;
    identification?: string;
    nit?: string;
    razonSocial?: string;
    formaJuridica?: string;
    [key: string]: unknown;
  };
}

export interface ElectronicBillingCustomerPayload {
  personType: 'Person' | 'Company';
  identification: string;
  firstName: string;
  lastName?: string;
  idIdentificationType: number;
  address: string;
  cityId: number;
  email: string;
  phoneNumber: string;
  vatResponsible: boolean;
  idCodeFiscalResponsabilities?: number[];
  contacts?: Array<{ firstName: string; lastName: string }>;
}

export interface ElectronicBillingSelection {
  enabled: boolean;
  customerIdentificationNumber?: string;
}

export interface AcceptancePolicy {
  pendingAmount: number;
  acceptedBillDenominations: number[];
  maxAcceptedBill: number;
  message: string;
  dispensableDenominations: number[];
}

export interface AdminSession {
  accessToken: string;
  email: string;
}

export interface DenominationInfo {
  id: number;
  kind: 'BILL' | 'COIN';
  currency: string;
  isActive: boolean;
}

export interface InventorySlot {
  denominationId: number;
  quantity: number;
  minThreshold: number;
  maxThreshold: number;
  denomination: DenominationInfo;
}

export interface CashMovement {
  id: number;
  type: 'LOAD' | 'UNLOAD' | 'ACCEPTED' | 'DISPENSED' | 'ADJUSTMENT';
  denominationId: number;
  quantity: number;
  unitValue: number;
  totalValue: number;
  reason: string;
  paymentSessionId: string | null;
  createdBy: string;
  createdAt: string;
  denomination: DenominationInfo;
}

export interface DeviceStatusSummary {
  id: number;
  code: string;
  name: string;
  type: string;
  driver: string;
  port: string | null;
  status: string;
  lastError: string | null;
  lastHeartbeatAt: string | null;
}

export interface CollectorTestStatus {
  enabled: boolean;
  samples?: CollectorSample[];
}

export interface CollectorSample {
  amount: number;
  kind: 'BILL' | 'COIN';
  source: string;
  receivedAt: string;
}

export interface ServerLinkStatus {
  connected: boolean;
  url: string;
  namespace: string;
  deviceUuid: string;
}

export interface CompletedPaymentSummary {
  id: string;
  serverProcessId: number | null;
  serverPaymentId: number | null;
  serverSyncStatus: string;
  qrCode: string | null;
  vehiclePlate: string | null;
  vehicleType: string | null;
  identificationType: string | null;
  identificationCode: string | null;
  concept: string | null;
  targetAmount: number;
  insertedAmount: number;
  changeAmount: number;
  status: string;
  startedAt: string;
  completedAt: string | null;
  failureReason: string | null;
  metadataJson: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DailyCollectionLine {
  denominationId: number;
  kind: string;
  quantity: number;
  subtotal: number;
}

export interface CashDashboardSummary {
  cycleStartedAt: string;
  paymentsBlocked: boolean;
  blockReason: string | null;
  kioskMode: string;
  changeInventoryTotal: number;
  transactionCount: number;
  totalCollected: number;
  collectionLines: DailyCollectionLine[];
  lastCloseout: {
    id: number;
    closedAt: string;
    closedBy: string;
    closeoutType: 'PARTIAL' | 'TOTAL';
    transactionCount: number;
    totalCollected: number;
    notes: string | null;
  } | null;
}

export interface CashCloseoutLine {
  id: number;
  closeoutId: number;
  denominationId: number;
  quantity: number;
  subtotal: number;
  denomination: DenominationInfo;
}

export interface CashCloseoutSummary {
  id: number;
  periodStartedAt: string;
  periodEndedAt: string;
  closedAt: string;
  closedBy: string;
  closeoutType: 'PARTIAL' | 'TOTAL';
  transactionCount: number;
  totalCollected: number;
  notes: string | null;
  receiptJson: string | null;
  createdAt: string;
  lines: CashCloseoutLine[];
}
