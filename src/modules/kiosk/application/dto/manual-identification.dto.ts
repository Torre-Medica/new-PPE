import { Matches } from 'class-validator';

export class ManualIdentificationDto {
  @Matches(/^\d{6,10}$/, { message: 'La cedula debe tener entre 6 y 10 digitos' })
  identificationNumber!: string;
}
