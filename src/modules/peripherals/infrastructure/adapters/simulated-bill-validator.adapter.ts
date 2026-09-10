import { Logger } from '@nestjs/common';
import { BillAcceptorPort } from '@modules/peripherals/domain/ports/bill-acceptor.port';

export class SimulatedBillValidatorAdapter implements BillAcceptorPort {
  private readonly logger = new Logger('SimulatedBillValidatorAdapter');

  async connect(port: string): Promise<boolean> {
    this.logger.log(`[SIMULADO] Billetero conectado en ${port}`);
    return true;
  }

  disconnect(): boolean {
    return true;
  }

  activate(): void {}

  deactivate(): void {}

  onBillReceived(): void {}

  onError(): void {}
}
