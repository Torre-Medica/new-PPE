export interface UpdateIncomePlateDto {
  ppeTransactionUuid: string;
  processId: number | null;
  qrCode: string | null;
  vehiclePlate: string;
}
