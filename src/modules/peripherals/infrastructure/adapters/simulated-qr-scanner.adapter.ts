import { Logger } from '@nestjs/common';
import { QrScannerPort } from '@modules/peripherals/domain/ports/qr-scanner.port';

export class SimulatedQrScannerAdapter implements QrScannerPort {
  private readonly logger = new Logger('SimulatedQrScannerAdapter');

  async connect(preferredPort?: string): Promise<string> {
    const port = preferredPort ?? 'SIMULATED';
    this.logger.log(`[SIMULADO] Lector QR conectado en ${port}`);
    return port;
  }

  async disconnect(): Promise<void> {}

  onQrCode(): void {}

  onInvalidQr(): void {}

  onError(): void {}
}
