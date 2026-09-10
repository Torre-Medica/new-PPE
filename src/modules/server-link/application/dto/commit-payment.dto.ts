export interface CommitPaymentDto {
  ppeTransactionUuid: string;
  processId: number | null;
  qrCode: string | null;
  vehiclePlate: string | null;
  vehicleType?: string | null;
  identificationType?: string | null;
  identificationCode?: string | null;
  concept?: string | null;
  targetAmount: number;
  insertedAmount: number;
  changeAmount: number;
  expectedOutcomeDatetime?: string | null;
  committedBy?: string | null;
  customerIdentificationNumber?: string | null;
}
