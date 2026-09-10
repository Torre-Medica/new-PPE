export interface QrScannerPort {
  connect(preferredPort?: string): Promise<string>;
  disconnect(): Promise<void>;
  onQrCode(handler: (qrCode: string, rawCode: string) => void): void;
  onInvalidQr(handler: (rawCode: string, reason: string) => void): void;
  onError(handler: (message: string) => void): void;
}
