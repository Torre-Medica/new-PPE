import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CommitPaymentDto } from '@modules/server-link/application/dto/commit-payment.dto';
import { CreateElectronicBillingCustomerDto } from '@modules/server-link/application/dto/electronic-billing.dto';
import {
  GenerateMonthlySubscriptionDto,
  MonthlySubscriptionCommitResponse,
  MonthlySubscriptionCustomerSummary,
  MonthlySubscriptionPreparation,
  MonthlySubscriptionServiceSummary,
  ValidateMonthlySubscriptionDto,
} from '@modules/server-link/application/dto/monthly-subscription.dto';

type JsonRecord = Record<string, unknown>;

@Injectable()
export class NexoBackRestService {
  private token: string | null = null;
  private cashPaymentTypeId: number | null = null;

  constructor(private readonly configService: ConfigService) {}

  syncPaymentPointCash(cash: {
    bill1Denomination: number;
    bill2Denomination: number;
    coin1Denomination: number;
    coin2Denomination: number;
    bill1Amount: number;
    bill2Amount: number;
    coin1Amount: number;
    coin2Amount: number;
  }) {
    const deviceUuid = this.configService.get<string>('serverLink.deviceUuid', '');
    return this.requestJson<{ success: boolean }>('/updatePaymentPointCash', {
      method: 'POST',
      auth: true,
      body: { ...cash, deviceUuid },
    });
  }

  async getElectronicBillingCatalogs() {
    const [identificationTypes, fiscalResponsibilities, cities] =
      await Promise.all([
        this.requestJson<unknown[]>('/listIdentificationType'),
        this.requestJson<unknown[]>('/listFiscalResponsibilities'),
        this.requestJson<unknown[]>('/cityList'),
      ]);

    return {
      identificationTypes,
      fiscalResponsibilities,
      cities,
    };
  }

  searchElectronicBillingCustomer(identification: string) {
    return this.requestJson<unknown>(
      `/searchInfoCustomer/${encodeURIComponent(identification)}`,
    );
  }

  createElectronicBillingCustomer(dto: CreateElectronicBillingCustomerDto) {
    return this.requestJson<unknown>('/createCustomerSiigo', {
      method: 'POST',
      body: dto,
    });
  }

  async prepareMonthlySubscription(
    identificationCode: string,
  ): Promise<MonthlySubscriptionPreparation> {
    const normalizedIdentification = identificationCode.trim();
    if (!normalizedIdentification) {
      throw new Error('No se recibio documento para mensualidad');
    }

    const services = await this.listMonthlyServices();
    const service = this.pickMonthlyService(services);

    const citizenshipResponse = await this.requestJson<unknown>(
      `/saic/citizenshipcard-scheduling?identificationNumber=${encodeURIComponent(
        normalizedIdentification,
      )}`,
      {
        auth: true,
        headers: {
          page: '1',
        },
      },
    );
    const citizenship = this.pickMonthlyCitizenship(
      normalizedIdentification,
      citizenshipResponse,
    );
    if (!citizenship) {
      throw new Error('La cedula no esta registrada para pago de mensualidad');
    }

    const customerResponse = await this.requestJson<unknown>(
      `/CustomerInformation/${encodeURIComponent(normalizedIdentification)}`,
      {
        auth: true,
      },
    );

    return {
      identificationType: 'CC',
      identificationCode: normalizedIdentification,
      service,
      customType: this.resolveMonthlyCustomType(service),
      customer: this.toMonthlyCustomerSummary(
        normalizedIdentification,
        customerResponse,
        citizenship,
      ),
    };
  }

  validateMonthlySubscription(dto: ValidateMonthlySubscriptionDto) {
    return this.requestJson<unknown>('/MonthlySubscription/Validate', {
      method: 'POST',
      auth: true,
      body: dto,
    });
  }

  async generateMonthlySubscriptionPayment(
    dto: GenerateMonthlySubscriptionDto,
    ppeTransactionUuid: string,
  ): Promise<MonthlySubscriptionCommitResponse> {
    const cashPaymentTypeId = await this.resolveCashPaymentTypeId();
    const payload: GenerateMonthlySubscriptionDto = {
      ...dto,
      generationDetail: {
        ...dto.generationDetail,
        paymentType: dto.generationDetail.paymentType ?? cashPaymentTypeId,
      },
    };
    const generated = this.asRecord(
      await this.requestJson<unknown>('/MonthlySubscription/Generate', {
        method: 'POST',
        auth: true,
        body: payload,
      }),
    );
    const paymentRegistered = generated.isSuccess === true;

    return {
      source: 'nexo-back-rest-monthly',
      paymentRegistered,
      allowedToExit: false,
      serverPaymentId:
        this.readNumber(generated.centralConsecutive) ??
        this.readNumber(generated.transactionId),
      ppeTransactionUuid,
      paidDatetime: new Date().toISOString(),
      CUFE: this.readString(generated.CUFE) ?? '',
      URL: this.readString(generated.URL) ?? '',
      response: generated,
    };
  }

  async commitElectronicBillingPayment(dto: CommitPaymentDto) {
    const customerIdentificationNumber =
      dto.customerIdentificationNumber?.trim() ?? '';
    if (!customerIdentificationNumber) {
      throw new Error('No se recibio documento de facturacion electronica');
    }

    const [validationResponse, cashPaymentTypeId] = await Promise.all([
      this.validateVisitorPayment(dto),
      this.resolveCashPaymentTypeId(),
    ]);

    const validation = this.asRecord(validationResponse);
    if (validation.isSuccess === false) {
      throw new Error(
        this.readString(validation.messageBody) ??
          this.readString(validation.messageTitle) ??
          'nexo_back rechazo la validacion del pago',
      );
    }

    const detail = this.asRecord(validation.validationDetail);
    const expectedOutcomeDatetime =
      dto.expectedOutcomeDatetime ??
      this.readIsoString(detail.expectedOutcomeDatetime) ??
      new Date().toISOString();

    const generatePayload: JsonRecord = {
      identificationType:
        this.readString(validation.identificationType) ??
        dto.identificationType ??
        'QR',
      identificationCode:
        this.readString(validation.identificationCode) ??
        dto.identificationCode ??
        dto.qrCode ??
        '',
      plate:
        dto.vehiclePlate ??
        this.readString(validation.plate) ??
        '',
      vehicleKind:
        this.readString(validation.vehicleKind) ??
        dto.vehicleType ??
        'CARRO',
      discountCode: this.readString(validation.discountCode) ?? '',
      datetime: new Date().toISOString(),
      cashier: dto.committedBy?.trim() || 'PPE',
      concept:
        this.readString(validation.concept) ??
        dto.concept ??
        'Parqueadero',
      IVAPercentage: this.readNumber(validation.IVAPercentage) ?? 0,
      IVATotal: this.readNumber(validation.IVATotal) ?? 0,
      total: dto.targetAmount,
      cashValue: dto.insertedAmount,
      discountTotal: this.readNumber(validation.discountTotal) ?? 0,
      processId:
        dto.processId ??
        this.readNumber(detail.processId) ??
        0,
      paymentType: cashPaymentTypeId,
      processPaidDatetime: expectedOutcomeDatetime,
      vehicleParkingTime: this.readString(detail.timeInParking) ?? '',
      customerIdentificationNumber,
      extraServices: Array.isArray(validation.extraServices)
        ? validation.extraServices
        : [],
    };

    const generated = this.asRecord(
      await this.requestJson<unknown>('/generatePaymentVisitorService', {
        method: 'POST',
        body: generatePayload,
        auth: true,
      }),
    );

    const serverPaymentId = this.readNumber(generated.transactionId);
    const paymentRegistered = generated.isSuccess === true;

    return {
      source: 'nexo-back-rest',
      paymentRegistered,
      allowedToExit: paymentRegistered,
      serverPaymentId,
      ppeTransactionUuid: dto.ppeTransactionUuid,
      paidDatetime: new Date().toISOString(),
      exitUntil: expectedOutcomeDatetime,
      CUFE: this.readString(generated.CUFE) ?? '',
      URL: this.readString(generated.URL) ?? '',
      response: generated,
    };
  }

  private validateVisitorPayment(dto: CommitPaymentDto) {
    const identificationCode =
      dto.identificationCode?.trim() || dto.qrCode?.trim() || '';
    if (!identificationCode) {
      throw new Error('No se recibio identificador para validar el pago');
    }

    return this.requestJson<unknown>('/validatePaymentVisitorService', {
      method: 'POST',
      auth: true,
      body: {
        identificationType: dto.identificationType ?? 'QR',
        identificationCode,
        plate: dto.vehiclePlate ?? '',
        discountCode: '',
        payDay: false,
      },
    });
  }

  private async resolveCashPaymentTypeId(): Promise<number> {
    if (this.cashPaymentTypeId) {
      return this.cashPaymentTypeId;
    }

    const paymentTypes = await this.requestJson<unknown[]>('/listPaymentsTypes', {
      auth: true,
    });
    const cashType = paymentTypes
      .map((item) => this.asRecord(item))
      .find((item) => {
        const name = this.readString(item.namePaymentType)?.trim().toLowerCase();
        return name === 'efectivo' || name === 'cash';
      });

    const id = cashType ? this.readNumber(cashType.id) : null;
    if (!id) {
      throw new Error('No se encontro el tipo de pago Efectivo en nexo_back');
    }

    this.cashPaymentTypeId = id;
    return id;
  }

  private async listMonthlyServices(): Promise<MonthlySubscriptionServiceSummary[]> {
    const services = await this.requestJson<unknown[]>('/services', {
      auth: true,
      headers: {
        type: 'Mensualidad',
      },
    });

    return Array.isArray(services)
      ? services.map((service) => this.asRecord(service))
      : [];
  }

  private pickMonthlyService(
    services: MonthlySubscriptionServiceSummary[],
  ): MonthlySubscriptionServiceSummary {
    const activeServices = services.filter((service) => service.isActive !== false);
    const exactMonthly = activeServices.find((service) => {
      const code = this.normalizeText(this.readString(service.code));
      const name = this.normalizeText(this.readString(service.name));
      const printName = this.normalizeText(this.readString(service.printName));
      const incomeConditionType = this.normalizeText(
        this.readString(service.incomeConditionType),
      );

      return [code, name, printName, incomeConditionType].some(
        (value) => value === 'mensualidad',
      );
    });

    const namedMonthly =
      exactMonthly ??
      activeServices.find((service) => {
        const haystack = [
          service.code,
          service.name,
          service.shortName,
          service.printName,
          service.serviceType,
          service.incomeConditionType,
        ]
          .map((value) => this.normalizeText(this.readString(value)))
          .join(' ');
        return haystack.includes('mensualidad');
      });

    if (!namedMonthly) {
      throw new Error('No hay un servicio activo de mensualidad configurado');
    }

    return namedMonthly;
  }

  private resolveMonthlyCustomType(
    service: MonthlySubscriptionServiceSummary,
  ): 'Mensualidad' | 'Mensualidad Interna' {
    const text = [
      service.code,
      service.name,
      service.shortName,
      service.printName,
      service.serviceType,
      service.incomeConditionType,
    ]
      .map((value) => this.normalizeText(this.readString(value)))
      .join(' ');

    return text.includes('mensualidad interna') || text.includes('mensualidadinterna')
      ? 'Mensualidad Interna'
      : 'Mensualidad';
  }

  private pickMonthlyCitizenship(
    identificationCode: string,
    response: unknown,
  ): JsonRecord | null {
    const records = Array.isArray(response)
      ? response.map((item) => this.asRecord(item))
      : Array.isArray(this.asRecord(response).data)
        ? (this.asRecord(response).data as unknown[]).map((item) => this.asRecord(item))
        : [];

    const exact = records.find((record) => {
      const identification =
        this.readString(record.identificationNumber) ??
        this.readString(record.identificationCode);
      return identification?.trim() === identificationCode;
    });

    return exact ?? records[0] ?? null;
  }

  private toMonthlyCustomerSummary(
    identificationCode: string,
    customerResponse: unknown,
    saicResponse: unknown,
  ): MonthlySubscriptionCustomerSummary {
    const customer = this.asRecord(customerResponse);
    const firstName = this.readString(customer.firstName);
    const secondName = this.readString(customer.secondName);
    const firstLastName = this.readString(customer.firstLastName);
    const secondLastName = this.readString(customer.secondLastName);
    const customerName = [
      firstName,
      secondName,
      firstLastName,
      secondLastName,
    ]
      .filter((value): value is string => !!value)
      .join(' ')
      .trim();

    return {
      identificationCode:
        this.readString(customer.identificationCode) ??
        this.readString(customer.identificationNumber) ??
        identificationCode,
      customerName: customerName || identificationCode,
      firstName: firstName ?? undefined,
      secondName: secondName ?? undefined,
      firstLastName: firstLastName ?? undefined,
      secondLastName: secondLastName ?? undefined,
      email: this.readString(customer.email) ?? undefined,
      phoneNumber: this.readString(customer.phoneNumber) ?? undefined,
      schedulingZone: this.readString(customer.schedulingZone) ?? undefined,
      schedulingZoneId: this.readNumber(customer.schedulingZoneId) ?? undefined,
      schedulingStartDatetime:
        this.readIsoString(customer.schedulingStartDatetime) ?? null,
      schedulingEndDatetime:
        this.readIsoString(customer.schedulingEndDatetime) ?? null,
      plate1: this.readString(customer.plate1) ?? undefined,
      plate2: this.readString(customer.plate2) ?? undefined,
      plate3: this.readString(customer.plate3) ?? undefined,
      rawCustomer: customerResponse,
      rawSaic: saicResponse,
    };
  }

  private async getToken(): Promise<string> {
    if (this.token) {
      return this.token;
    }

    const authKey = this.configService.get<string>('serverLink.restAuthKey', '');
    if (!authKey) {
      throw new Error(
        'Falta configurar NEXO_BACK_KEY_CRYPTO para autenticar el PPE contra nexo_back',
      );
    }

    const response = await fetch(
      this.buildUrl(`/loginFront/${encodeURIComponent(authKey)}`),
      {
        method: 'POST',
        headers: {
          Accept: 'application/json',
        },
      },
    );

    if (!response.ok) {
      throw new Error(await this.readResponseError(response));
    }

    const data = (await response.json()) as JsonRecord;
    const token = this.readString(data.token);
    if (!token) {
      throw new Error('nexo_back no devolvio token de autenticacion');
    }

    this.token = token;
    return token;
  }

  private async requestJson<T>(
    path: string,
    options: {
      method?: string;
      body?: unknown;
      auth?: boolean;
      retryAuth?: boolean;
      headers?: Record<string, string>;
    } = {},
  ): Promise<T> {
    const headers: Record<string, string> = {
      Accept: 'application/json',
      ...options.headers,
    };

    if (options.body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }

    if (options.auth) {
      headers.Authorization = `Bearer ${await this.getToken()}`;
    }

    const response = await fetch(this.buildUrl(path), {
      method: options.method ?? 'GET',
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });

    if (
      response.status === 401 &&
      options.auth &&
      options.retryAuth !== false
    ) {
      this.token = null;
      return this.requestJson<T>(path, {
        ...options,
        retryAuth: false,
      });
    }

    if (!response.ok) {
      throw new Error(await this.readResponseError(response));
    }

    if (response.status === 204) {
      return null as T;
    }

    return (await response.json()) as T;
  }

  private buildUrl(path: string): string {
    const baseUrl = this.configService
      .get<string>('serverLink.url', 'http://localhost:3001')
      .replace(/\/+$/, '');
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    return `${baseUrl}${normalizedPath}`;
  }

  private async readResponseError(response: Response): Promise<string> {
    const text = await response.text().catch(() => '');
    if (!text) {
      return `nexo_back respondio ${response.status}`;
    }

    try {
      const parsed = JSON.parse(text) as JsonRecord;
      const message = this.readString(parsed.message) ?? this.readString(parsed.error);
      return message ?? text;
    } catch {
      return text;
    }
  }

  private asRecord(value: unknown): JsonRecord {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as JsonRecord)
      : {};
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

  private readIsoString(value: unknown): string | null {
    if (typeof value === 'string' && value.trim().length > 0) {
      return value;
    }

    return null;
  }

  private normalizeText(value: string | null): string {
    return (value ?? '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim();
  }
}
