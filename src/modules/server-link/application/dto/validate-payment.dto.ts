export interface ValidatePaymentDto {
  ppeTransactionUuid: string;
  qrCode?: string | null;
  vehiclePlate?: string | null;
}
