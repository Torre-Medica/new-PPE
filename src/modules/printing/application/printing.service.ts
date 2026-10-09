import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CashCloseoutEntity } from '@modules/persistence/infrastructure/entities/cash-closeout.entity';
import {
  PaymentSessionEntity,
  PaymentSessionStatus,
} from '@modules/persistence/infrastructure/entities/payment-session.entity';
import { SERVER_LINK_PORT } from '@modules/server-link/domain/ports/server-link.port';
import type { ServerLinkPort } from '@modules/server-link/domain/ports/server-link.port';
import type { CompanyInfoSummary } from '@modules/server-link/application/dto/company-info.dto';
import type { PaymentInvoice } from '@modules/server-link/application/dto/payment-invoice.dto';

type PrinterConfigRecord = {
  JAVA_SERVER_URL: string;
  PRINTER_NAME: string;
};

type PrinterOperation =
  | { accion: 'textalign'; datos: string }
  | { accion: 'feed'; datos: string }
  | { accion: 'text'; datos: string }
  | { accion: 'qr'; datos: string }
  | { accion: 'cut'; datos: string };

type CloseoutReceiptRow = {
  item: string;
  quantity?: number | string | null;
  total?: number | string | null;
};

type CloseoutReceiptSection = {
  title: string;
  rows: CloseoutReceiptRow[];
  summaryRows?: CloseoutReceiptRow[];
  total?: number | string | null;
};

type CloseoutReceiptPayload = {
  title?: string;
  subtitle?: string;
  machine?: string;
  closeoutId?: number | string | null;
  closeoutType?: 'PARTIAL' | 'TOTAL' | string | null;
  responsible?: string | null;
  periodStartedAt?: string;
  periodEndedAt?: string;
  transactionCount?: number | string | null;
  transactionsTicket?: CloseoutReceiptSection;
  sections?: CloseoutReceiptSection[];
  footerLines?: string[];
};

type PaymentReceiptMetadata = {
  validation?: {
    startDatetime?: string | null;
    paidDatetime?: string | null;
    expectedOutcomeDatetime?: string | null;
    incomeConditionType?: string | null;
    concept?: string | null;
    vehicleType?: string | null;
    vehiclePlate?: string | null;
    identificationType?: string | null;
    identificationCode?: string | null;
  };
  commit?: {
    paymentRegistered?: boolean;
    allowedToExit?: boolean;
    paidDatetime?: string | null;
    exitUntil?: string | null;
    serverPaymentId?: number | null;
  };
  monthlySubscription?: {
    validated?: boolean;
    validationDetail?: {
      requestedMonthlySubscriptionStartDatetime?: string | null;
      requestedMonthlySubscriptionEndDatetime?: string | null;
      [key: string]: unknown;
    } | null;
  };
};

const TICKET_WIDTH = 42;
const ITEM_COLUMN_WIDTH = 20;

@Injectable()
export class PrintingService {
  private static readonly BOGOTA_TIME_ZONE = 'America/Bogota';
  private readonly configDir = join(process.cwd(), 'config_files');
  private readonly configFile = join(this.configDir, 'printerConfig.txt');

  private static readonly FALLBACK_COMPANY_NAME =
    'CORPORACION UNIVERSITARIA MINUTO DE DIOS';
  private static readonly FALLBACK_COMPANY_ADDRESS =
    'Seccional Bello - Sede Antioquia-Choco\nCarrera 45 # 22D - 25\nBello, Colombia';

  constructor(
    @InjectRepository(PaymentSessionEntity)
    private readonly paymentSessionRepository: Repository<PaymentSessionEntity>,
    @InjectRepository(CashCloseoutEntity)
    private readonly cashCloseoutRepository: Repository<CashCloseoutEntity>,
    private readonly configService: ConfigService,
    @Inject(SERVER_LINK_PORT)
    private readonly serverLink: ServerLinkPort,
  ) {}

  private async getCompanyInfoSafe(): Promise<CompanyInfoSummary> {
    try {
      return await this.serverLink.getCompanyInfo();
    } catch {
      return {
        name: PrintingService.FALLBACK_COMPANY_NAME,
        address: PrintingService.FALLBACK_COMPANY_ADDRESS,
      };
    }
  }

  async printPaymentReceipt(paymentSessionId: string) {
    const session = await this.paymentSessionRepository.findOne({
      where: { id: paymentSessionId },
      relations: ['paymentLines', 'paymentLines.denomination'],
    });

    if (!session) {
      throw new NotFoundException(`No existe la sesion ${paymentSessionId}`);
    }

    if (
      session.status !== PaymentSessionStatus.Completed &&
      session.status !== PaymentSessionStatus.CompletedWithWarning &&
      session.status !== PaymentSessionStatus.CommittingToServer
    ) {
      throw new NotFoundException(
        `La sesion ${paymentSessionId} aun no esta lista para imprimir recibo`,
      );
    }

    const metadata = this.parsePaymentReceiptMetadata(session.metadataJson);
    const receiptIdentifier = session.id;
    const startedAt =
      metadata?.validation?.startDatetime ?? session.startedAt?.toISOString() ?? null;
    const estimatedExitAt =
      metadata?.commit?.exitUntil ??
      metadata?.validation?.expectedOutcomeDatetime ??
      metadata?.validation?.paidDatetime ??
      session.completedAt?.toISOString() ??
      null;
    const vehicleType =
      metadata?.validation?.vehicleType ?? session.vehicleType ?? 'No registrado';
    const tariffName =
      metadata?.validation?.incomeConditionType ??
      session.concept ??
      metadata?.validation?.concept ??
      'No registrada';
    const monthlySubscriptionStartAt =
      metadata?.monthlySubscription?.validationDetail?.requestedMonthlySubscriptionStartDatetime ??
      null;
    const monthlySubscriptionEndAt =
      metadata?.monthlySubscription?.validationDetail?.requestedMonthlySubscriptionEndDatetime ??
      null;
    const isMonthlySubscriptionReceipt = Boolean(
      monthlySubscriptionStartAt && monthlySubscriptionEndAt,
    );
    const vehiclePlate = metadata?.validation?.vehiclePlate?.trim() || null;

    // Factura completa (la misma de la caja del servidor) si el pago ya quedo
    // registrado en nexo_back; si no se puede obtener, va el recibo basico.
    const serverPaymentId = metadata?.commit?.serverPaymentId;
    if (serverPaymentId) {
      try {
        const invoice = await this.serverLink.getPaymentInvoice(serverPaymentId);
        if (invoice) {
          return this.sendToPrinter(
            this.buildInvoiceOperations(invoice, {
              plate: vehiclePlate,
              startedAt,
              monthlyStartAt: monthlySubscriptionStartAt,
              monthlyEndAt: monthlySubscriptionEndAt,
            }),
          );
        }
      } catch (error) {
        console.error(
          `No se pudo obtener la factura del pago ${serverPaymentId}; se imprime el recibo basico: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    const companyInfo = await this.getCompanyInfoSafe();
    const operations: PrinterOperation[] = [
      { accion: 'textalign', datos: 'center' },
      { accion: 'text', datos: companyInfo.name },
      { accion: 'text', datos: companyInfo.address },
      { accion: 'feed', datos: '1' },
      { accion: 'textalign', datos: 'left' },
      { accion: 'text', datos: `Fecha de impresion: ${this.formatDate(new Date())}` },
      { accion: 'text', datos: 'Forma de pago: Contado' },
      { accion: 'text', datos: 'Metodo de pago: Efectivo' },
      ...(isMonthlySubscriptionReceipt
        ? [
            {
              accion: 'text' as const,
              datos: `Inicio mensualidad: ${this.formatDateValue(monthlySubscriptionStartAt)}`,
            },
            {
              accion: 'text' as const,
              datos: `Fin mensualidad: ${this.formatDateValue(monthlySubscriptionEndAt)}`,
            },
          ]
        : [
            {
              accion: 'text' as const,
              datos: `Fecha de ingreso: ${this.formatDateValue(startedAt)}`,
            },
            {
              accion: 'text' as const,
              datos: `Salida estimada: ${this.formatDateValue(estimatedExitAt)}`,
            },
          ]),
      { accion: 'text', datos: this.separator() },
      { accion: 'text', datos: 'Cantidad total:' },
      { accion: 'text', datos: this.composeColumns('', 'Total', `$ ${session.targetAmount.toLocaleString('es-CO')}`) },
      { accion: 'text', datos: this.composeColumns('', 'Recibido', `$ ${session.insertedAmount.toLocaleString('es-CO')}`) },
      { accion: 'text', datos: this.composeColumns('', 'Cambio', `$ ${session.changeAmount.toLocaleString('es-CO')}`) },
      { accion: 'text', datos: this.separator() },
      { accion: 'text', datos: `Vehiculo: ${vehicleType}` },
      { accion: 'text', datos: `Placa: ${vehiclePlate ?? 'Sin placa'}` },
      { accion: 'text', datos: `Tarifa: ${tariffName}` },
      { accion: 'text', datos: `Sesion PPE: ${receiptIdentifier}` },
      { accion: 'feed', datos: '3' },
      { accion: 'cut', datos: 'full' },
    ];

    return this.sendToPrinter(operations);
  }

  // Misma informacion y orden que la factura de la caja del servidor
  // (frontend: app/libs/Printer.ts, imprimirFacturaTransaccion).
  private buildInvoiceOperations(
    invoice: PaymentInvoice,
    extra: {
      plate: string | null;
      startedAt: string | null;
      monthlyStartAt: string | null;
      monthlyEndAt: string | null;
    },
  ): PrinterOperation[] {
    const header = invoice.header ?? {};
    const totals = invoice.descriptionTotal?.[0] ?? {};
    const plate = header.PLACA?.trim() || extra.plate || 'Sin placa';
    const text = (datos: string): PrinterOperation => ({ accion: 'text', datos });
    const amountRow = (label: string, value: number | string | undefined) =>
      text(this.composeColumns(label, '', this.formatAmount(value ?? 0)));

    const operations: PrinterOperation[] = [
      { accion: 'textalign', datos: 'center' },
      text(invoice.empresa ?? ''),
      text(`NIT: ${invoice.nit ?? ''}`),
      text(invoice.direccion ?? ''),
      text(this.separator()),
      { accion: 'textalign', datos: 'left' },
      text(`FACTURA ELECTRONICA DE VENTA: ${header.FACTURA_ELECTRONICA_DE_VENTA ?? ''}`),
      text(`FECHA DE VENTA: ${header.FECHA_DE_VENTA ?? ''}`),
      text(`REGIMEN: ${header.REGIMEN ?? ''}`),
      text(`Cliente: ${header.CLIENTE ?? ''}`),
      text(`CC/NIT: ${header.NIT ?? ''}`),
      text(`FORMA DE PAGO: ${header.FORMA_DE_PAGO ?? 'Contado'}`),
      text(`MEDIO DE PAGO: ${header.MEDIO_DE_PAGO ?? 'Efectivo'}`),
      text(`PLACA: ${plate}`),
    ];

    if (header.FECHA_FIN_MENSUALIDAD || (extra.monthlyStartAt && extra.monthlyEndAt)) {
      operations.push(
        text(
          `INICIO MENSUALIDAD: ${header.FECHA_INICIO_MENSUALIDAD || this.formatDateValue(extra.monthlyStartAt)}`,
        ),
        text(
          `FIN MENSUALIDAD: ${header.FECHA_FIN_MENSUALIDAD || this.formatDateValue(extra.monthlyEndAt)}`,
        ),
      );
      if (header.TIEMPO_PAGADO_MENSUALIDAD) {
        operations.push(text(`TIEMPO PAGADO: ${header.TIEMPO_PAGADO_MENSUALIDAD}`));
      }
    } else {
      // La fecha de ingreso real la trae la sesion de la PPE (la del backend
      // puede venir con la hora de la venta).
      operations.push(
        text(
          `FECHA DE INGRESO: ${
            extra.startedAt ? this.formatDateValue(extra.startedAt) : (header.FECHA_DE_INGRESO ?? '')
          }`,
        ),
        text(`DURACION: ${header.DURACION ?? ''}`),
      );
    }

    operations.push(
      text(`PUNTO DE PAGO: ${header.PUNTO_DE_PAGO ?? ''}`),
      text(this.separator()),
      text(this.headerRow()),
    );

    for (const line of invoice.description ?? []) {
      operations.push(
        text(
          this.dataRow(
            String(line.DESCRIPCION ?? ''),
            String(line.CANTIDAD ?? ''),
            this.formatAmount(line.VALOR ?? 0),
          ),
        ),
      );
    }

    operations.push(
      text(this.separator()),
      text(this.composeColumns('Cantidad Total:', '', String(totals.CANTIDAD_TOTAL ?? 0))),
      amountRow('Base:', totals.BASE),
      amountRow('Descuento:', totals.DESCUENTO),
      amountRow('Subtotal:', totals.SUBTOTAL),
      amountRow('IVA 19%:', totals.IVA_19),
      amountRow('Total:', totals.TOTAL),
      amountRow('Recibido:', totals.RECIBIDO),
      amountRow('Cambio:', totals.CAMBIO),
      text(this.separator()),
    );

    // CUFE (con QR de consulta en la DIAN) y resolucion
    const cufe = invoice.infoCufe?.CUFE;
    if (cufe) {
      operations.push(
        { accion: 'textalign', datos: 'center' },
        {
          accion: 'qr',
          datos: `https://catalogo-vpfe.dian.gov.co/document/searchqr?documentkey=${cufe}`,
        },
        { accion: 'textalign', datos: 'left' },
      );
    }
    operations.push(text(`CUFE: ${cufe || 'no disponible'}`), { accion: 'feed', datos: '1' });

    for (const line of this.cleanLines(invoice.infoResolution)) {
      operations.push(text(line));
    }
    operations.push(
      text(`FABRICANTE DE SOFTWARE: ${invoice.infoSoftwareManufacturer ?? ''}`),
      { accion: 'feed', datos: '1' },
      text(`PROVEEDOR TECNOLOGICO: ${invoice.infoTechnologyProvider ?? ''}`),
      { accion: 'feed', datos: '1' },
    );

    // "Numero de poliza Numero de Poliza AXA ... vigencia ... al ..." +
    // "Vigencia hasta ...": una sola linea con la poliza y su vigencia.
    const policy = this.cleanLines(invoice.infoPolice)[0] ?? '';
    if (policy) {
      operations.push(
        text(policy.replace(/^n[uú]mero de p[oó]liza\s+(?=n[uú]mero de p[oó]liza)/i, '')),
      );
    }

    operations.push({ accion: 'feed', datos: '3' }, { accion: 'cut', datos: 'full' });
    return operations;
  }

  // Lineas sin espacios sobrantes (el backend arma estos textos con saltos de
  // linea y la sangria del codigo).
  private cleanLines(value?: string | null): string[] {
    return String(value ?? '')
      .split(/\r?\n|\\n/)
      .map((line) => line.replace(/\s+/g, ' ').trim())
      .filter((line) => line.length > 0);
  }

  async printCashCloseout(closeoutId: number) {
    const closeout = await this.cashCloseoutRepository.findOne({
      where: { id: closeoutId },
      relations: ['lines', 'lines.denomination'],
    });

    if (!closeout) {
      throw new NotFoundException(`No existe el cierre ${closeoutId}`);
    }

    const enrichedReceipt = this.parseCloseoutReceipt(closeout.receiptJson);
    const operations = enrichedReceipt
      ? this.buildEnrichedCloseoutOperations(closeout, enrichedReceipt)
      : this.buildBasicCloseoutOperations(closeout);

    return this.sendToPrinter(operations);
  }

  private buildBasicCloseoutOperations(closeout: CashCloseoutEntity): PrinterOperation[] {
    const operations: PrinterOperation[] = [
      { accion: 'textalign', datos: 'center' },
      { accion: 'text', datos: 'CIERRE DE CAJA PPE' },
      { accion: 'feed', datos: '1' },
      {
        accion: 'text',
        datos: `Maquina: ${this.configService.get<string>('printing.machineName', 'PPE')}`,
      },
      { accion: 'textalign', datos: 'left' },
      { accion: 'text', datos: this.separator() },
      { accion: 'text', datos: `Tipo: ${closeout.closeoutType === 'PARTIAL' ? 'Parcial' : 'Total'}` },
      { accion: 'text', datos: `Fecha cierre: ${this.formatDate(closeout.closedAt)}` },
      { accion: 'text', datos: `Responsable: ${closeout.closedBy}` },
      { accion: 'text', datos: `Transacciones: ${closeout.transactionCount}` },
      { accion: 'text', datos: `Total retirado: $ ${closeout.totalCollected.toLocaleString('es-CO')}` },
      { accion: 'feed', datos: '1' },
      { accion: 'text', datos: this.headerRow() },
      { accion: 'text', datos: this.separator() },
    ];

    for (const line of closeout.lines) {
      operations.push({
        accion: 'text',
        datos: this.dataRow(
          `${line.denomination.kind === 'BILL' ? 'Billete' : 'Moneda'} $${line.denominationId.toLocaleString('es-CO')}`,
          String(line.quantity),
          `$ ${line.subtotal.toLocaleString('es-CO')}`,
        ),
      });
    }

    operations.push(
      { accion: 'text', datos: this.separator() },
      {
        accion: 'text',
        datos: this.totalLine(closeout.totalCollected),
      },
      { accion: 'feed', datos: '2' },
      { accion: 'cut', datos: 'full' },
    );
    return operations;
  }

  /**
   * El cierre se imprime en dos tickets separados por un corte:
   * 1. Ticket corto de transacciones (Visitante Carro/Moto, exitosas, canceladas, total).
   * 2. Cierre completo con todas las secciones.
   */
  private buildEnrichedCloseoutOperations(
    closeout: CashCloseoutEntity,
    receipt: CloseoutReceiptPayload,
  ): PrinterOperation[] {
    // Cierres guardados antes de existir el ticket corto: se arma con la seccion de transacciones
    const transactionsTicket =
      receipt.transactionsTicket ??
      receipt.sections?.find((section) => section.title === 'Transacciones');

    const operations: PrinterOperation[] = [];

    if (transactionsTicket) {
      operations.push(
        ...this.buildCloseoutHeaderOperations(closeout, receipt, false),
        ...this.buildCloseoutSectionOperations(transactionsTicket),
        { accion: 'feed', datos: '2' },
        { accion: 'cut', datos: 'full' },
      );
    }

    operations.push(...this.buildCloseoutHeaderOperations(closeout, receipt, true));

    for (const section of receipt.sections ?? []) {
      operations.push(...this.buildCloseoutSectionOperations(section));
    }

    operations.push(
      { accion: 'text', datos: this.separator() },
      { accion: 'textalign', datos: 'left' },
      { accion: 'text', datos: `Tipo: ${(receipt.closeoutType ?? closeout.closeoutType) === 'PARTIAL' ? 'Parcial' : 'Total'}` },
      ...this.responsibleOperations(receipt.responsible ?? closeout.closedBy, true),
      ...this.labelValueOperations('Fecha cierre:', this.formatDate(closeout.closedAt)),
    );

    for (const line of receipt.footerLines ?? []) {
      operations.push(
        ...this.wrapText(line).map((datos) => ({ accion: 'text' as const, datos })),
      );
    }

    operations.push({ accion: 'feed', datos: '2' }, { accion: 'cut', datos: 'full' });
    return operations;
  }

  private buildCloseoutHeaderOperations(
    closeout: CashCloseoutEntity,
    receipt: CloseoutReceiptPayload,
    responsibleOnOwnLine: boolean,
  ): PrinterOperation[] {
    const machineName =
      receipt.machine ?? this.configService.get<string>('printing.machineName', 'PPE');
    const operations: PrinterOperation[] = [{ accion: 'textalign', datos: 'center' }];

    if (receipt.subtitle) {
      operations.push({ accion: 'text', datos: receipt.subtitle });
    }

    operations.push({ accion: 'text', datos: `Maquina: ${machineName}` });

    if (receipt.periodStartedAt) {
      operations.push({ accion: 'text', datos: `Desde: ${this.formatDate(new Date(receipt.periodStartedAt))}` });
    }

    if (receipt.periodEndedAt) {
      operations.push({ accion: 'text', datos: `Hasta: ${this.formatDate(new Date(receipt.periodEndedAt))}` });
    }

    operations.push(
      { accion: 'textalign', datos: 'left' },
      { accion: 'text', datos: this.separator() },
      { accion: 'text', datos: `ID cierre: ${String(receipt.closeoutId ?? closeout.id)}` },
      ...this.responsibleOperations(receipt.responsible ?? closeout.closedBy, responsibleOnOwnLine),
      {
        accion: 'text',
        datos: `Transacciones: ${String(receipt.transactionCount ?? closeout.transactionCount)}`,
      },
      { accion: 'text', datos: this.separator() },
    );

    return operations;
  }

  private buildCloseoutSectionOperations(section: CloseoutReceiptSection): PrinterOperation[] {
    const operations: PrinterOperation[] = [
      { accion: 'textalign', datos: 'center' },
      { accion: 'text', datos: section.title },
      { accion: 'textalign', datos: 'left' },
      { accion: 'text', datos: this.headerRow() },
      { accion: 'text', datos: this.separator() },
      ...section.rows.flatMap((row) => this.closeoutRowOperations(row)),
    ];

    const hasTotal = section.total !== undefined && section.total !== null && section.total !== '';

    if (section.summaryRows?.length) {
      // Separador, filas de resumen y el TOTAL inmediatamente debajo
      operations.push(
        { accion: 'text', datos: this.separator() },
        ...section.summaryRows.flatMap((row) => this.closeoutRowOperations(row)),
      );
      if (hasTotal) {
        operations.push({ accion: 'text', datos: this.totalLine(section.total!) });
      }
    } else if (hasTotal) {
      operations.push(
        { accion: 'text', datos: this.separator() },
        { accion: 'text', datos: this.totalLine(section.total!) },
      );
    }

    operations.push({ accion: 'feed', datos: '1' });
    return operations;
  }

  private closeoutRowOperations(row: CloseoutReceiptRow): PrinterOperation[] {
    const quantity = row.quantity !== undefined && row.quantity !== null ? String(row.quantity) : '';
    const total = row.total !== undefined && row.total !== null ? this.formatAmount(row.total) : '';
    const item = row.item.replace(/\s+/g, ' ').trim();

    // Nombre mas largo que la columna Item (ej. "Transacciones canceladas"): el nombre va
    // solo en una linea y Cnt/Total en la siguiente, para no descuadrar las columnas.
    if (item.length > ITEM_COLUMN_WIDTH) {
      return [
        { accion: 'text', datos: item },
        { accion: 'text', datos: this.dataRow('', quantity, total) },
      ];
    }

    return [{ accion: 'text', datos: this.dataRow(item, quantity, total) }];
  }

  // "Responsable: x" en una sola linea, o el valor en la linea siguiente cuando se pide
  // (o cuando no cabe en el ancho del ticket).
  private responsibleOperations(responsible: string, ownLine: boolean): PrinterOperation[] {
    const singleLine = `Responsable: ${responsible}`;
    if (!ownLine && singleLine.length <= this.contentWidth) {
      return [{ accion: 'text', datos: singleLine }];
    }

    return [
      { accion: 'text', datos: 'Responsable:' },
      { accion: 'text', datos: responsible },
    ];
  }

  private parseCloseoutReceipt(raw: string | null): CloseoutReceiptPayload | null {
    if (!raw) {
      return null;
    }

    try {
      const parsed = JSON.parse(raw) as CloseoutReceiptPayload;
      if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.sections)) {
        return null;
      }
      return parsed;
    } catch {
      return null;
    }
  }

  private parsePaymentReceiptMetadata(raw: string | null): PaymentReceiptMetadata | null {
    if (!raw) {
      return null;
    }

    try {
      const parsed = JSON.parse(raw) as PaymentReceiptMetadata;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return null;
      }
      return parsed;
    } catch {
      return null;
    }
  }

  private formatAmount(value: number | string): string {
    if (typeof value === 'number') {
      return `$ ${value.toLocaleString('es-CO')}`;
    }

    const numeric = Number(value);
    if (!Number.isNaN(numeric)) {
      return `$ ${numeric.toLocaleString('es-CO')}`;
    }

    return String(value);
  }

  private separator(): string {
    return '-'.repeat(this.contentWidth);
  }

  private headerRow(): string {
    return this.composeColumns('Item', 'Cnt', 'Total');
  }

  private totalLine(value: number | string): string {
    return this.composeColumns('TOTAL', '', this.formatAmount(value));
  }

  private dataRow(item: string, quantity: string, total: string): string {
    return this.composeColumns(item, quantity, total);
  }

  private composeColumns(item: string, quantity: string, total: string): string {
    // itemWidth reducido y quantityWidth angosto para dejarle mas espacio a
    // totalWidth: con los anchos anteriores (20/6) los montos grandes (ej.
    // "$ 3.052.400", 11 caracteres) se truncaban ("$ 3.052~") por quedar solo
    // 9 caracteres disponibles para el total.
    const itemWidth = ITEM_COLUMN_WIDTH;
    const quantityWidth = 4;
    const totalWidth = this.contentWidth - itemWidth - quantityWidth - 2;

    return [
      this.fitText(item, itemWidth).padEnd(itemWidth, ' '),
      this.fitText(quantity, quantityWidth).padStart(quantityWidth, ' '),
      this.fitText(total, totalWidth).padStart(totalWidth, ' '),
    ].join(' ');
  }

  // Margen izquierdo configurable (PRINTER_LEFT_PADDING); el ancho util del ticket se reduce en la misma medida.
  private get leftPadding(): number {
    const value = Number(this.configService.get<number>('printing.leftPadding', 1));
    return Number.isInteger(value) && value >= 0 ? value : 1;
  }

  private get contentWidth(): number {
    return TICKET_WIDTH - this.leftPadding;
  }

  private withLeftPadding(value: string): string {
    return `${' '.repeat(this.leftPadding)}${value}`;
  }

  // Parte un texto en lineas que caben en el ancho util, cortando por palabras.
  private wrapText(value: string): string[] {
    const width = this.contentWidth;
    const lines: string[] = [];
    let current = '';

    for (const word of value.replace(/\s+/g, ' ').trim().split(' ')) {
      if (!current) {
        current = word;
      } else if (`${current} ${word}`.length <= width) {
        current = `${current} ${word}`;
      } else {
        lines.push(current);
        current = word;
      }
      while (current.length > width) {
        lines.push(current.slice(0, width));
        current = current.slice(width);
      }
    }

    if (current) {
      lines.push(current);
    }
    return lines;
  }

  // "Etiqueta: valor" en una linea si cabe; si no, la etiqueta arriba y el valor debajo.
  private labelValueOperations(label: string, value: string): PrinterOperation[] {
    const singleLine = `${label} ${value}`;
    if (singleLine.length <= this.contentWidth) {
      return [{ accion: 'text', datos: singleLine }];
    }

    return [label, ...this.wrapText(value)].map((datos) => ({ accion: 'text' as const, datos }));
  }

  private fitText(value: string, width: number): string {
    const normalized = value.replace(/\s+/g, ' ').trim();
    if (normalized.length <= width) {
      return normalized;
    }

    if (width <= 1) {
      return normalized.slice(0, width);
    }

    return `${normalized.slice(0, width - 1)}~`;
  }

  private async sendToPrinter(operations: PrinterOperation[]) {
    const config = this.getPrinterConfiguration();
    // El margen solo aplica a las lineas alineadas a la izquierda: en las centradas
    // los espacios corren el texto hacia la derecha.
    let alignment = 'left';
    const paddedOperations = operations.map((operation) => {
      if (operation.accion === 'textalign') {
        alignment = operation.datos;
      }
      return operation.accion === 'text' && alignment === 'left'
        ? { ...operation, datos: this.withLeftPadding(operation.datos) }
        : operation;
    });

    const response = await fetch(config.JAVA_SERVER_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        nombre_impresora: config.PRINTER_NAME,
        operaciones: paddedOperations,
      }),
    });

    if (!response.ok) {
      throw new Error(`No se pudo conectar con el servicio de impresion: ${response.status}`);
    }

    const body = (await response.json().catch(() => null)) as boolean | null;

    return {
      success: body === true,
      printerName: config.PRINTER_NAME,
      javaServerUrl: config.JAVA_SERVER_URL,
    };
  }

  private getPrinterConfiguration(): PrinterConfigRecord {
    const defaultConfig: PrinterConfigRecord = {
      JAVA_SERVER_URL: this.configService.get<string>(
        'printing.javaServerUrl',
        'http://localhost:8080/imprimir',
      ),
      PRINTER_NAME: this.configService.get<string>('printing.printerName', 'printer'),
    };

    if (!existsSync(this.configDir)) {
      mkdirSync(this.configDir, { recursive: true });
    }

    if (!existsSync(this.configFile)) {
      writeFileSync(this.configFile, JSON.stringify(defaultConfig, null, 2));
      return defaultConfig;
    }

    try {
      const loaded = JSON.parse(readFileSync(this.configFile, 'utf8')) as Partial<PrinterConfigRecord>;
      return {
        JAVA_SERVER_URL: loaded.JAVA_SERVER_URL ?? defaultConfig.JAVA_SERVER_URL,
        PRINTER_NAME: loaded.PRINTER_NAME ?? defaultConfig.PRINTER_NAME,
      };
    } catch {
      return defaultConfig;
    }
  }

  private formatDate(date: Date | null) {
    if (!date) {
      return '';
    }

    return new Intl.DateTimeFormat('es-CO', {
      timeZone: PrintingService.BOGOTA_TIME_ZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true,
    }).format(new Date(date));
  }

  private formatDateValue(value: string | Date | null) {
    if (!value) {
      return '';
    }

    return this.formatDate(value instanceof Date ? value : new Date(value));
  }
}
