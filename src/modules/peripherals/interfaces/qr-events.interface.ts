export interface QrScannedEvent {
  source: 'QR_SCANNER';
  qrCode: string;
  rawCode: string;
  port: string | null;
  scannedAt: string;
}
