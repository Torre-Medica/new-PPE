import { DomainError } from '@common/errors/domain.error';

export class PaymentSessionConflictError extends DomainError {
  readonly httpStatus = 409;

  constructor(message: string) {
    super(message);
    this.name = 'PaymentSessionConflictError';
  }
}
