// Mismos formatos que valida el backend del PPE (payment-core/domain/vehicle-plate.ts)
// y nexo_back: carro ABC123, moto ABC12D.
export type PlateVehicleKind = 'CARRO' | 'MOTO';

const PLATE_PATTERNS: Record<PlateVehicleKind, RegExp> = {
  CARRO: /^[A-Z]{3}\d{3}$/,
  MOTO: /^[A-Z]{3}\d{2}[A-Z]$/,
};

export const PLATE_FORMAT_EXAMPLES: Record<PlateVehicleKind, string> = {
  CARRO: 'ABC123',
  MOTO: 'ABC12D',
};

export function normalizePlate(value: string): string {
  return value.toUpperCase().replace(/[\s-]+/g, '');
}

/**
 * Placa distinta a la del tiquete: 2 o mas caracteres diferentes en su misma
 * posicion (AWR234 vs AWT252). Un solo caracter distinto (SDE222 vs SDE223) se
 * toma como error de digitacion. La diferencia de largo cuenta como distinta.
 */
export function isDifferentPlate(typed: string, registered: string): boolean {
  const a = normalizePlate(typed);
  const b = normalizePlate(registered);
  if (!a || !b) return false;
  let differences = Math.abs(a.length - b.length);
  for (let i = 0; i < Math.min(a.length, b.length); i += 1) {
    if (a[i] !== b[i]) differences += 1;
  }
  return differences >= 2;
}

export function resolvePlateVehicleKind(vehicleType: string | null | undefined): PlateVehicleKind | null {
  const upper = (vehicleType ?? '').toUpperCase();
  if (upper.includes('MOTO')) return 'MOTO';
  if (upper.includes('CAR')) return 'CARRO';
  return null;
}

/** Mensaje de error para mostrar en pantalla, o null si la placa es valida. */
export function validatePlate(value: string, kind: PlateVehicleKind | null): string | null {
  const plate = normalizePlate(value);
  if (!plate) {
    return 'Ingrese la placa del vehiculo';
  }
  if (kind) {
    return PLATE_PATTERNS[kind].test(plate)
      ? null
      : `Formato de ${kind === 'MOTO' ? 'moto' : 'carro'} invalido. Ejemplo: ${PLATE_FORMAT_EXAMPLES[kind]}`;
  }
  return PLATE_PATTERNS.CARRO.test(plate) || PLATE_PATTERNS.MOTO.test(plate)
    ? null
    : `Placa invalida. Carro ${PLATE_FORMAT_EXAMPLES.CARRO} o moto ${PLATE_FORMAT_EXAMPLES.MOTO}`;
}
