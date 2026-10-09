// Formatos de placa colombiana, iguales a los que usa nexo_back (getVehicleTypeByPlate):
//   Carro: 3 letras + 3 numeros        -> ABC123
//   Moto:  3 letras + 2 numeros + letra -> ABC12D
export type PlateVehicleKind = 'CARRO' | 'MOTO';

const PLATE_PATTERNS: Record<PlateVehicleKind, RegExp> = {
  CARRO: /^[A-Z]{3}\d{3}$/,
  MOTO: /^[A-Z]{3}\d{2}[A-Z]$/,
};

export const PLATE_FORMAT_EXAMPLES: Record<PlateVehicleKind, string> = {
  CARRO: 'ABC123',
  MOTO: 'ABC12D',
};

/** Mayusculas y sin espacios ni guiones ("abc-123" -> "ABC123"). */
export function normalizePlate(value: string): string {
  return value.toUpperCase().replace(/[\s-]+/g, '');
}

/** Tipo de vehiculo del ticket ("CARRO", "CAR", "MOTO"...) o null si no se reconoce. */
export function resolvePlateVehicleKind(vehicleType: string | null | undefined): PlateVehicleKind | null {
  const upper = (vehicleType ?? '').toUpperCase();
  if (upper.includes('MOTO')) {
    return 'MOTO';
  }
  if (upper.includes('CAR')) {
    return 'CARRO';
  }
  return null;
}

export function isValidPlateForVehicle(plate: string, kind: PlateVehicleKind): boolean {
  return PLATE_PATTERNS[kind].test(plate);
}
