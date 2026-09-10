import { DomainError } from '@common/errors/domain.error';

export class PaymentSessionNotFoundError extends DomainError {
  readonly httpStatus = 404;

  constructor(sessionId: string) {
    super(`No existe la sesion ${sessionId}`);
    this.name = 'PaymentSessionNotFoundError';
  }
}
