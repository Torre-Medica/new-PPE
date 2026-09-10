import { DispenserSlotKey } from '@modules/persistence/infrastructure/entities/dispenser-slot.entity';

export interface DispenseUnitsResult {
  success: boolean;
  timedOut: boolean;
}

export interface ChangeDispenserPort {
  connect(port: string): Promise<boolean>;
  disconnect(): boolean;
  activate(): void;
  deactivate(): void;
  buildReturnRawCommand(frameBytes: [number, number, number, number], total: number): number[];
  returnRaw(frameBytes: [number, number, number, number], total: number): void;
  returnChange(
    returnValue: number,
    bill1Denomination: number,
    bill2Denomination: number,
    coin1Denomination: number,
    coin2Denomination: number,
  ): void;
  /**
   * Manda una trama RETURN aislada (tabla fija de docs/TRAMAS_DEVOLUCION_PLACA.md) para
   * expulsar `quantity` unidades de un solo slot, y espera la confirmacion (ACK) de la
   * placa antes de resolver.
   */
  dispenseUnits(
    slotKey: DispenserSlotKey,
    quantity: number,
    ackTimeoutMs?: number,
  ): Promise<DispenseUnitsResult>;
  onCoinReceived(handler: (amount: string) => void): void;
  onBillReceived(handler: (amount: string) => void): void;
  onError(handler: (message: string) => void): void;
}
