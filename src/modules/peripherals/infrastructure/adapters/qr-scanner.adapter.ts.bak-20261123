import { ReadlineParser, SerialPort } from 'serialport';
import { QrScannerPort } from '@modules/peripherals/domain/ports/qr-scanner.port';

type SerialPortInfo = Awaited<ReturnType<typeof SerialPort.list>>[number];

export class QrScannerAdapter implements QrScannerPort {
  private port: SerialPort | null = null;
  private parser: ReadlineParser | null = null;
  private qrHandler: ((qrCode: string, rawCode: string) => void) | null = null;
  private invalidQrHandler: ((rawCode: string, reason: string) => void) | null = null;
  private errorHandler: ((message: string) => void) | null = null;
  private connectedPortPath: string | null = null;

  constructor(
    private readonly configuredBaudRate: number,
    private readonly excludedPorts: string[],
  ) {}

  async connect(preferredPort?: string): Promise<string> {
    const portPath = preferredPort ?? (await this.findPort());
    if (!portPath) {
      throw new Error('No se encontro un puerto serial utilizable para el lector QR');
    }

    if (this.port?.isOpen && this.connectedPortPath === portPath) {
      return portPath;
    }

    await this.disconnect();

    this.port = new SerialPort({
      path: portPath,
      baudRate: this.configuredBaudRate,
      autoOpen: false,
    });

    await new Promise<void>((resolve, reject) => {
      this.port?.open((error) => {
        if (error) {
          reject(
            new Error(`No se pudo abrir el puerto ${portPath} del lector QR: ${error.message}`),
          );
          return;
        }

        resolve();
      });
    });

    this.connectedPortPath = portPath;
    this.parser = this.port.pipe(new ReadlineParser({ delimiter: '\r\n' }));
    this.parser.on('data', (data: string | Buffer) => {
      void this.handleQrData(data.toString());
    });

    this.port.on('data', (data: Buffer) => {
      const chunk = data.toString().trim();
      if (chunk.length > 0 && !chunk.includes('\r') && !chunk.includes('\n')) {
        void this.handleQrData(chunk);
      }
    });

    this.port.on('error', (error) => {
      this.errorHandler?.(`Error en el lector QR: ${error.message}`);
    });

    this.port.on('close', () => {
      this.errorHandler?.('Se cerro la conexion con el lector QR');
      this.connectedPortPath = null;
    });

    return portPath;
  }

  async disconnect(): Promise<void> {
    this.parser?.removeAllListeners();
    this.parser = null;

    if (!this.port?.isOpen) {
      this.port = null;
      this.connectedPortPath = null;
      return;
    }

    await new Promise<void>((resolve) => {
      this.port?.close(() => resolve());
    });

    this.port = null;
    this.connectedPortPath = null;
  }

  onQrCode(handler: (qrCode: string, rawCode: string) => void): void {
    this.qrHandler = handler;
  }

  onInvalidQr(handler: (rawCode: string, reason: string) => void): void {
    this.invalidQrHandler = handler;
  }

  onError(handler: (message: string) => void): void {
    this.errorHandler = handler;
  }

  private async findPort(): Promise<string | null> {
    const ports = await SerialPort.list();
    const qrCandidate = this.findPreferredCandidate(ports);
    return qrCandidate?.path ?? null;
  }

  private findPreferredCandidate(ports: SerialPortInfo[]): SerialPortInfo | undefined {
    const normalizedExcludedPorts = new Set(
      this.excludedPorts.map((port) => port.trim().toUpperCase()).filter((port) => port.length > 0),
    );

    const filteredPorts = ports.filter((port) => {
      const path = port.path.trim().toUpperCase();
      return path.length > 0 && !normalizedExcludedPorts.has(path);
    });

    const scannerKeywords = [
      'QR',
      'SCANNER',
      'BARCODE',
      'HONEYWELL',
      'NEWLAND',
      'ZEBRA',
      'DENSO',
      'IMAGER',
    ];

    const keywordMatch = filteredPorts.find((port) => {
      const descriptor = [
        port.manufacturer,
        port.pnpId,
        port.vendorId,
        port.productId,
        port.serialNumber,
      ]
        .filter((value) => typeof value === 'string' && value.length > 0)
        .join(' ')
        .toUpperCase();

      return scannerKeywords.some((keyword) => descriptor.includes(keyword));
    });

    if (keywordMatch) {
      return keywordMatch;
    }

    const serialUsbMatch = filteredPorts.find((port) => {
      const path = port.path.toUpperCase();
      return (
        path.startsWith('COM') ||
        path.includes('/DEV/TTYUSB') ||
        path.includes('/DEV/TTYACM')
      );
    });

    return serialUsbMatch;
  }

  private async handleQrData(rawData: string): Promise<void> {
    const result = this.normalizeQrData(rawData);
    if (!result.valid) {
      this.invalidQrHandler?.(rawData, result.reason ?? 'QR no valido');
      return;
    }

    const cleaned = result.value;
    if (!cleaned) {
      return;
    }

    this.qrHandler?.(cleaned, rawData);
  }

  private normalizeQrData(value: string): { valid: boolean; value: string | null; reason?: string } {
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      return {
        valid: false,
        value: null,
        reason: 'Lectura vacia del lector QR',
      };
    }

    const cleaned = trimmed.replace(/[\[\]][Q0]+/g, '').trim();
    if (cleaned.length === 0) {
      return {
        valid: false,
        value: null,
        reason: 'No fue posible limpiar la lectura del lector QR',
      };
    }

    if (cleaned.includes(',')) {
      return {
        valid: true,
        value: cleaned.split(',')[0]?.trim() ?? null,
      };
    }

    const uuidRegex =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (uuidRegex.test(cleaned)) {
      return {
        valid: true,
        value: cleaned,
      };
    }

    if (cleaned.includes('http://') || cleaned.includes('https://')) {
      try {
        const url = new URL(cleaned);
        const companyCode = url.searchParams.get('companyCode');
        if (companyCode?.trim()) {
          return {
            valid: true,
            value: companyCode.trim(),
          };
        }

        return {
          valid: false,
          value: null,
          reason: 'El QR contiene URL pero no trae el parametro companyCode',
        };
      } catch {
        return {
          valid: false,
          value: null,
          reason: 'El QR contiene una URL invalida',
        };
      }
    }

    return {
      valid: true,
      value: cleaned,
    };
  }
}
