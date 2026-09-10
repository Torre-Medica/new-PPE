import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { BillAcceptorPort } from '@modules/peripherals/domain/ports/bill-acceptor.port';
import { installVendorConsoleFilter } from '@modules/peripherals/infrastructure/vendor-console-filter';

type LegacyBillValidator = {
  connect: (port: string) => Promise<boolean>;
  disconnect: () => boolean;
  activate: () => void;
  deactivate: () => void;
  billCommand?: (billAcceptance: number, escrowAcceptance: number) => unknown;
  onBillReceived: (cb: (amount: string) => void) => unknown;
  onBillPending: (cb: (amount: string) => void) => unknown;
  onBillReturned: (cb: (amount: string) => void) => unknown;
  onError: (cb: (message: string) => void) => unknown;
};

export class BillValidatorAdapter implements BillAcceptorPort {
  private static readonly BILL_DENOMINATIONS = [1000, 2000, 5000, 10000, 20000, 50000, 100000];
  private legacy: LegacyBillValidator | null = null;
  private billReceivedHandler: ((amount: string) => void) | null = null;
  private errorHandler: ((message: string) => void) | null = null;

  constructor(private readonly legacyPath: string) {}

  private resolveLegacyPath(): string {
    if (this.legacyPath.length > 0) {
      return this.legacyPath;
    }

    return join(
      process.cwd(),
      'vendor',
      'peripherals',
      'coins-tech-coins-bill-validator-1.0.2',
      'dist',
      'bill-validator',
      'bill-validator.js',
    );
  }

  private loadLegacy(): LegacyBillValidator {
    installVendorConsoleFilter();
    const resolvedPath = this.resolveLegacyPath();
    if (!existsSync(resolvedPath)) {
      throw new Error(`No se encontro la libreria del billetero en ${resolvedPath}`);
    }

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const legacyModule = require(resolvedPath);
    return legacyModule.default as LegacyBillValidator;
  }

  async connect(port: string): Promise<boolean> {
    this.legacy = this.loadLegacy();

    // La librería vendor hace throw dentro de callbacks de SerialPort en lugar de
    // rechazar la Promise, lo que escapa a cualquier try/catch. Se intercepta aquí.
    return new Promise<boolean>((resolve, reject) => {
      const uncaughtHandler = (error: Error) => {
        process.removeListener('uncaughtException', uncaughtHandler);
        reject(error);
      };
      process.once('uncaughtException', uncaughtHandler);

      Promise.resolve(this.legacy!.connect(port))
        .then((result) => {
          process.removeListener('uncaughtException', uncaughtHandler);
          if (this.billReceivedHandler) this.legacy!.onBillReceived(this.billReceivedHandler);
          if (this.errorHandler) this.legacy!.onError(this.errorHandler);
          resolve(result);
        })
        .catch((error: unknown) => {
          process.removeListener('uncaughtException', uncaughtHandler);
          reject(error instanceof Error ? error : new Error(String(error)));
        });
    });
  }

  disconnect(): boolean {
    if (!this.legacy) {
      return true;
    }

    return this.legacy.disconnect();
  }

  activate(acceptedDenominations?: number[]): void {
    if (
      acceptedDenominations &&
      this.legacy?.billCommand &&
      typeof this.legacy.billCommand === 'function'
    ) {
      const mask = this.buildAcceptanceMask(acceptedDenominations);
      this.legacy.billCommand(mask, 0);
      return;
    }

    this.legacy?.activate();
  }

  deactivate(): void {
    this.legacy?.deactivate();
  }

  onBillReceived(handler: (amount: string) => void): void {
    this.billReceivedHandler = handler;
    this.legacy?.onBillReceived(handler);
  }

  onError(handler: (message: string) => void): void {
    this.errorHandler = handler;
    this.legacy?.onError(handler);
  }

  private buildAcceptanceMask(acceptedDenominations: number[]): number {
    const accepted = new Set(acceptedDenominations);

    return BillValidatorAdapter.BILL_DENOMINATIONS.reduce((mask, denomination, index) => {
      if (!accepted.has(denomination)) {
        return mask;
      }

      return mask | (1 << index);
    }, 0);
  }
}
