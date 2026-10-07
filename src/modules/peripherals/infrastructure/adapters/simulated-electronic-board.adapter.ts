import { Logger } from '@nestjs/common';
import {
  ChangeDispenserPort,
  ReturnAckResult,
} from '@modules/peripherals/domain/ports/change-dispenser.port';

export class SimulatedElectronicBoardAdapter implements ChangeDispenserPort {
  private readonly logger = new Logger('SimulatedElectronicBoardAdapter');

  async connect(port: string): Promise<boolean> {
    this.logger.log(`[SIMULADO] Placa electronica conectada en ${port}`);
    return true;
  }

  disconnect(): boolean {
    return true;
  }

  activate(): void {}

  deactivate(): void {}

  buildReturnRawCommand(frameBytes: [number, number, number, number], total: number): number[] {
    const command = [0x0e, 0xc9, 0x01, 0x3c, frameBytes[0], frameBytes[1], frameBytes[2], frameBytes[3], 0, 0, 0, 0, 0, 0];
    command[8] = (Number(total) & 0xff000000) >> 24;
    command[9] = (Number(total) & 0x00ff0000) >> 16;
    command[10] = (Number(total) & 0x0000ff00) >> 8;
    command[11] = Number(total) & 0x000000ff;

    let checksum = 0;
    for (let index = 0; index < 12; index += 1) {
      checksum += command[index];
    }
    command[12] = (checksum >> 8) & 0xff;
    command[13] = checksum & 0xff;

    return command;
  }

  returnRaw(frameBytes: [number, number, number, number], total: number): void {
    const command = this.buildReturnRawCommand(frameBytes, total);
    const commandHex = command.map((v) => v.toString(16).padStart(2, '0').toUpperCase()).join(' ');
    this.logger.log(`[SIMULADO] returnRaw total=${total} command=${commandHex}`);
  }

  returnChange(
    returnValue: number,
    bill1Denomination: number,
    bill2Denomination: number,
    coin1Denomination: number,
    coin2Denomination: number,
  ): void {
    this.logger.log(
      `[SIMULADO] returnChange total=${returnValue} bill1=${bill1Denomination} bill2=${bill2Denomination} coin1=${coin1Denomination} coin2=${coin2Denomination}`,
    );
  }

  returnWithAck(frameBytes: [number, number, number, number], total: number): Promise<ReturnAckResult> {
    this.returnRaw(frameBytes, total);
    this.logger.log(`[SIMULADO] returnWithAck total=${total} -> ACK inmediato`);
    return Promise.resolve({ success: true, timedOut: false });
  }

  onCoinReceived(): void {}

  onBillReceived(): void {}

  onError(): void {}
}
