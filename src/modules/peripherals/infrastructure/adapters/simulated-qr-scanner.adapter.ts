import { Logger } from '@nestjs/common';
import { QrScannerPort } from '@modules/peripherals/domain/ports/qr-scanner.port';

export class SimulatedQrScannerAdapter implements QrScannerPort {
  private readonly logger = new Logger('SimulatedQrScannerAdapter');
  private qrCodeHandler: ((qrCode: string, rawCode: string) => void) | null = null;

  async connect(preferredPort?: string): Promise<string> {
    const port = preferredPort ?? 'SIMULATED';
    this.logger.log(`[SIMULADO] Lector QR conectado en ${port}`);
    return port;
  }

  async disconnect(): Promise<void> {}

  onQrCode(handler: (qrCode: string, rawCode: string) => void): void {
    this.qrCodeHandler = handler;
  }

  onInvalidQr(): void {}

  onError(): void {}

  /** Entrega un codigo como si lo hubiera leido el lector fisico (solo pruebas). */
  emitScan(qrCode: string): void {
    this.logger.log(`[SIMULADO] QR leido: ${qrCode}`);
    this.qrCodeHandler?.(qrCode, qrCode);
  }
}
