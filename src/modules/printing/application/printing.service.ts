import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CashCloseoutEntity } from '@modules/persistence/infrastructure/entities/cash-closeout.entity';
import {
  PaymentSessionEntity,
  PaymentSessionStatus,
} from '@modules/persistence/infrastructure/entities/payment-session.entity';

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
};

const TICKET_WIDTH = 42;
const LEFT_PADDING = '     ';
const CONTENT_WIDTH = TICKET_WIDTH - LEFT_PADDING.length;

@Injectable()
export class PrintingService {
  private static readonly BOGOTA_TIME_ZONE = 'America/Bogota';
  private readonly configDir = join(process.cwd(), 'config_files');
  private readonly configFile = join(this.configDir, 'printerConfig.txt');

  constructor(
    @InjectRepository(PaymentSessionEntity)
    private readonly paymentSessionRepository: Repository<PaymentSessionEntity>,
    @InjectRepository(CashCloseoutEntity)
    private readonly cashCloseoutRepository: Repository<CashCloseoutEntity>,
    private readonly configService: ConfigService,
  ) {}

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
    const operations: PrinterOperation[] = [
      { accion: 'textalign', datos: 'center' },
      { accion: 'text', datos: 'CORPORACION UNIVERSITARIA MINUTO DE DIOS' },
      { accion: 'text', datos: 'Seccional Bello - Sede Antioquia-Choco' },
      { accion: 'text', datos: 'Carrera 45 # 22D - 25' },
      { accion: 'text', datos: 'Bello, Colombia' },
      { accion: 'feed', datos: '1' },
      { accion: 'textalign', datos: 'left' },
      { accion: 'text', datos: `Fecha de impresion: ${this.formatDate(new Date())}` },
      { accion: 'text', datos: 'Forma de pago: Contado' },
      { accion: 'text', datos: 'Metodo de pago: Efectivo' },
      { accion: 'text', datos: `Fecha de ingreso: ${this.formatDateValue(startedAt)}` },
      { accion: 'text', datos: `Salida estimada: ${this.formatDateValue(estimatedExitAt)}` },
      { accion: 'text', datos: this.separator() },
      { accion: 'text', datos: 'Cantidad total:' },
      { accion: 'text', datos: this.composeColumns('', 'Total', `$ ${session.targetAmount.toLocaleString('es-CO')}`) },
      { accion: 'text', datos: this.composeColumns('', 'Recibido', `$ ${session.insertedAmount.toLocaleString('es-CO')}`) },
      { accion: 'text', datos: this.composeColumns('', 'Cambio', `$ ${session.changeAmount.toLocaleString('es-CO')}`) },
      { accion: 'text', datos: this.separator() },
      { accion: 'text', datos: `Vehiculo: ${vehicleType}` },
      { accion: 'text', datos: `Tarifa: ${tariffName}` },
      { accion: 'text', datos: `Sesion PPE: ${receiptIdentifier}` },
      { accion: 'feed', datos: '3' },
      { accion: 'cut', datos: 'full' },
    ];

    return this.sendToPrinter(operations);
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

  private buildEnrichedCloseoutOperations(
    closeout: CashCloseoutEntity,
    receipt: CloseoutReceiptPayload,
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

    operations.push({ accion: 'textalign', datos: 'left' });
    operations.push({ accion: 'text', datos: this.separator() });
    operations.push({
      accion: 'text',
      datos: `ID cierre: ${String(receipt.closeoutId ?? closeout.id)}`,
    });
    operations.push({
      accion: 'text',
      datos: `Responsable: ${receipt.responsible ?? closeout.closedBy}`,
    });
    operations.push({
      accion: 'text',
      datos: `Transacciones: ${String(receipt.transactionCount ?? closeout.transactionCount)}`,
    });
    operations.push({ accion: 'text', datos: this.separator() });

    for (const section of receipt.sections ?? []) {
      operations.push(
        { accion: 'textalign', datos: 'center' },
        { accion: 'text', datos: section.title },
        { accion: 'textalign', datos: 'left' },
        { accion: 'text', datos: this.headerRow() },
        { accion: 'text', datos: this.separator() },
      );

      for (const row of section.rows) {
        operations.push({ accion: 'textalign', datos: 'left' });
        operations.push({
          accion: 'text',
          datos: this.dataRow(
            row.item,
            row.quantity !== undefined && row.quantity !== null ? String(row.quantity) : '',
            row.total !== undefined && row.total !== null ? this.formatAmount(row.total) : '',
          ),
        });
      }

      if (section.total !== undefined && section.total !== null && section.total !== '') {
        operations.push(
          { accion: 'text', datos: this.separator() },
          {
            accion: 'text',
            datos: this.totalLine(section.total),
          },
        );
      }

      operations.push({ accion: 'feed', datos: '1' });
    }

    operations.push(
      { accion: 'text', datos: this.separator() },
      { accion: 'textalign', datos: 'left' },
      { accion: 'text', datos: `Tipo: ${(receipt.closeoutType ?? closeout.closeoutType) === 'PARTIAL' ? 'Parcial' : 'Total'}` },
      { accion: 'text', datos: `Responsable: ${receipt.responsible ?? closeout.closedBy}` },
      { accion: 'text', datos: `Fecha cierre: ${this.formatDate(closeout.closedAt)}` },
    );

    for (const line of receipt.footerLines ?? []) {
      operations.push({ accion: 'text', datos: line });
    }

    operations.push({ accion: 'feed', datos: '2' }, { accion: 'cut', datos: 'full' });
    return operations;
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
    return '-'.repeat(CONTENT_WIDTH);
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
    const itemWidth = 18;
    const quantityWidth = 4;
    const totalWidth = CONTENT_WIDTH - itemWidth - quantityWidth - 2;

    return [
      this.fitText(item, itemWidth).padEnd(itemWidth, ' '),
      this.fitText(quantity, quantityWidth).padStart(quantityWidth, ' '),
      this.fitText(total, totalWidth).padStart(totalWidth, ' '),
    ].join(' ');
  }

  private withLeftPadding(value: string): string {
    return `${LEFT_PADDING}${value}`;
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
    const paddedOperations = operations.map((operation) =>
      operation.accion === 'text'
        ? {
            ...operation,
            datos: this.withLeftPadding(operation.datos),
          }
        : operation,
    );

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
