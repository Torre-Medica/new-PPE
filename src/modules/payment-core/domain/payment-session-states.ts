import { PaymentSessionStatus } from '@modules/persistence/infrastructure/entities/payment-session.entity';

export const ACTIVE_SESSION_STATUSES: PaymentSessionStatus[] = [
  PaymentSessionStatus.Created,
  PaymentSessionStatus.Validating,
  PaymentSessionStatus.Validated, // Reservado: el flujo actual salta Validating → ListeningCash
  PaymentSessionStatus.ListeningCash,
  PaymentSessionStatus.ChangePending,
  PaymentSessionStatus.DispensingChange,
  PaymentSessionStatus.ReadyToCommit,
];

/** Sesiones que un QR distinto puede reemplazar si aun no tienen dinero. */
export const REPLACEABLE_SESSION_STATUSES: PaymentSessionStatus[] = [
  PaymentSessionStatus.Validated,
  PaymentSessionStatus.ListeningCash,
];

export const CASH_ACCEPTING_STATUSES: PaymentSessionStatus[] = [
  PaymentSessionStatus.ListeningCash,
];

export const COMPLETABLE_STATUSES: PaymentSessionStatus[] = [
  PaymentSessionStatus.ReadyToCommit,
  PaymentSessionStatus.ChangePending,
];
