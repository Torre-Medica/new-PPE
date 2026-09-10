export interface CancelPaymentDto {
  ppeTransactionUuid: string;
  processId?: number | null;
  qrCode?: string | null;
  vehiclePlate?: string | null;
  reason: string;
}
