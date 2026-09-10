import { DomainError } from '@common/errors/domain.error';

export class CashDenominationRejectedError extends DomainError {
  readonly httpStatus = 409;

  constructor(denomination: number, maxAcceptedBill: number) {
    super(
      maxAcceptedBill > 0
        ? `No se cuenta con devuelta suficiente para recibir un billete de $${denomination.toLocaleString('es-CO')} en este momento. La denominacion maxima aceptada es $${maxAcceptedBill.toLocaleString('es-CO')}.`
        : `No se cuenta con devuelta suficiente para recibir un billete de $${denomination.toLocaleString('es-CO')} en este momento.`,
    );
    this.name = 'CashDenominationRejectedError';
  }
}
