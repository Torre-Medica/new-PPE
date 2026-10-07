export interface ReturnAckResult {
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
   * Manda una trama RETURN con las denominaciones reales de los 4 slots
   * (`frameBytes`) y el `total` a devolver, y espera la confirmacion (ACK) de la
   * placa antes de resolver. Ver docs/TRAMAS_DEVOLUCION_PLACA.md.
   */
  returnWithAck(
    frameBytes: [number, number, number, number],
    total: number,
    ackTimeoutMs?: number,
  ): Promise<ReturnAckResult>;
  onCoinReceived(handler: (amount: string) => void): void;
  onBillReceived(handler: (amount: string) => void): void;
  onError(handler: (message: string) => void): void;
}
