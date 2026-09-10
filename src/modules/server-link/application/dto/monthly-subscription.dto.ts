export interface MonthlySubscriptionServiceSummary {
  id?: number;
  name?: string;
  shortName?: string;
  printName?: string;
  code?: string;
  serviceType?: string;
  isActive?: boolean;
  [key: string]: unknown;
}

export interface MonthlySubscriptionCustomerSummary {
  identificationCode: string;
  customerName: string;
  firstName?: string;
  secondName?: string;
  firstLastName?: string;
  secondLastName?: string;
  email?: string;
  phoneNumber?: string;
  schedulingZone?: string;
  schedulingZoneId?: number;
  schedulingStartDatetime?: string | null;
  schedulingEndDatetime?: string | null;
  plate1?: string;
  plate2?: string;
  plate3?: string;
  rawCustomer?: unknown;
  rawSaic?: unknown;
  [key: string]: unknown;
}

export interface MonthlySubscriptionPreparation {
  identificationType: 'CC';
  identificationCode: string;
  service: MonthlySubscriptionServiceSummary;
  customType: 'Mensualidad' | 'Mensualidad Interna';
  customer: MonthlySubscriptionCustomerSummary;
}

export interface ValidateMonthlySubscriptionDto {
  identificationType: 'CC';
  identificationCode: string;
  plate: string;
  discountCode?: string;
  isApportionment?: boolean;
  customType?: string;
  monthsForPay?: number;
  apportionmentStartDatetime?: string | null;
  apportionmentEndDatetime?: string | null;
}

export interface GenerateMonthlySubscriptionDto {
  customerIdentificationNumber?: string;
  identificationType: 'CC';
  identificationCode: string;
  plate: string;
  vehicleKind?: string;
  discountCode?: string;
  datetime: string;
  cashier: string;
  concept: string;
  grossTotal?: number;
  subtotal: number;
  IVAPercentage: number;
  IVATotal: number;
  total: number;
  discountAmount?: number;
  monthlySubscriptionStartDatetime: string;
  monthlySubscriptionEndDatetime: string;
  extraServices: Array<Record<string, unknown> | null>;
  generationDetail: {
    monthlySubscriptionId?: number;
    internalId?: number;
    internalConsecutive?: string;
    paymentType?: number;
    cashValue?: number;
    returnValue?: number;
    cashDetail?: string;
    billsEntered?: number;
    coinsEntered?: number;
    zoneId?: number;
  };
}

export interface MonthlySubscriptionCommitResponse {
  source: 'nexo-back-rest-monthly';
  paymentRegistered: boolean;
  allowedToExit: boolean;
  serverPaymentId: number | null;
  ppeTransactionUuid: string;
  paidDatetime: string;
  CUFE: string;
  URL: string;
  response: Record<string, unknown>;
}
