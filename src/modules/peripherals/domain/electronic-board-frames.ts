import { DispenserSlotKey } from '@modules/persistence/infrastructure/entities/dispenser-slot.entity';

export interface ReturnFrameSpec {
  selector: [number, number, number, number];
  unitMultiplier: number;
  maxUnitsPerOrder: number;
}

/**
 * Tramas RETURN fijas por slot, validadas en campo (docs/TRAMAS_DEVOLUCION_PLACA.md).
 * `selector` no representa la denominacion real cargada en el slot — es un patron que
 * la placa usa para elegir el canal fisico y su modo interno de devolucion. `total` en
 * la trama se calcula como `cantidad * unitMultiplier`, sin relacion con el valor real
 * de la denominacion (eso lo maneja el software via dispenser_slots).
 */
export const RETURN_FRAME_BY_SLOT: Record<DispenserSlotKey, ReturnFrameSpec> = {
  bill1: { selector: [2, 50, 5, 5], unitMultiplier: 2000, maxUnitsPerOrder: 9 },
  bill2: { selector: [50, 2, 5, 5], unitMultiplier: 2000, maxUnitsPerOrder: 9 },
  coin1: { selector: [50, 50, 50, 5], unitMultiplier: 50, maxUnitsPerOrder: 9 },
  coin2: { selector: [50, 50, 5, 50], unitMultiplier: 50, maxUnitsPerOrder: 9 },
};
