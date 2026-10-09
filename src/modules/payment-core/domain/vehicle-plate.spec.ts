import {
  isValidPlateForVehicle,
  normalizePlate,
  resolvePlateVehicleKind,
} from '@modules/payment-core/domain/vehicle-plate';

describe('vehicle-plate', () => {
  it('normaliza a mayusculas sin espacios ni guiones', () => {
    expect(normalizePlate(' abc-123 ')).toBe('ABC123');
    expect(normalizePlate('abc 12d')).toBe('ABC12D');
  });

  it('reconoce el tipo de vehiculo del ticket', () => {
    expect(resolvePlateVehicleKind('CARRO')).toBe('CARRO');
    expect(resolvePlateVehicleKind('CAR')).toBe('CARRO');
    expect(resolvePlateVehicleKind('MOTO')).toBe('MOTO');
    expect(resolvePlateVehicleKind(null)).toBeNull();
  });

  it('acepta solo el formato de carro para carros', () => {
    expect(isValidPlateForVehicle('ABC123', 'CARRO')).toBe(true);
    expect(isValidPlateForVehicle('ABC12D', 'CARRO')).toBe(false);
    expect(isValidPlateForVehicle('AB1234', 'CARRO')).toBe(false);
  });

  it('acepta solo el formato de moto para motos', () => {
    expect(isValidPlateForVehicle('ABC12D', 'MOTO')).toBe(true);
    expect(isValidPlateForVehicle('ABC123', 'MOTO')).toBe(false);
    expect(isValidPlateForVehicle('ABC12', 'MOTO')).toBe(false);
  });
});
