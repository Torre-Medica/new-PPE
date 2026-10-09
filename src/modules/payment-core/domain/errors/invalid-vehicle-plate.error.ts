import { DomainError } from '@common/errors/domain.error';

export class InvalidVehiclePlateError extends DomainError {
  readonly httpStatus = 400;

  constructor(message: string) {
    super(message);
    this.name = 'InvalidVehiclePlateError';
  }
}
