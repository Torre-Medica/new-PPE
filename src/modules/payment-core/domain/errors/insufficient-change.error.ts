import { DomainError } from '@common/errors/domain.error';

export class InsufficientChangeError extends DomainError {
  readonly httpStatus = 409;

  constructor(changeAmount: number, remaining: number) {
    super(`No hay inventario suficiente para devolver ${changeAmount}. Faltan ${remaining}`);
    this.name = 'InsufficientChangeError';
  }
}
