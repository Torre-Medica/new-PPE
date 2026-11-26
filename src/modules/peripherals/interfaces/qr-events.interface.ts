export interface QrScannedEvent {
  // MANUAL_ENTRY: cedula digitada en el kiosko (cedula nueva que el lector no interpreta)
  source: 'QR_SCANNER' | 'MANUAL_ENTRY';
  qrCode: string;
  rawCode: string;
  port: string | null;
  scannedAt: string;
}
