import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { Logger } from '@nestjs/common';
import {
  ChangeDispenserPort,
  ReturnAckResult,
} from '@modules/peripherals/domain/ports/change-dispenser.port';
import { installVendorConsoleFilter } from '@modules/peripherals/infrastructure/vendor-console-filter';

type LegacyElectronicBoard = {
  port?: {
    isOpen?: boolean;
    write: (data: number[] | Uint8Array | Buffer) => void;
    removeAllListeners?: (event?: string) => void;
  };
  connect: (port: string) => Promise<boolean>;
  disconnect: () => boolean;
  activate: () => void;
  deactivate: () => void;
  return: (
    returnValue: number,
    bill1Denomination: number,
    bill2Denomination: number,
    coin1Denomination: number,
    coin2Denomination: number,
  ) => void;
  onCoinReceived: (cb: (amount: string) => void) => unknown;
  onBillReceived: (cb: (amount: string) => void) => unknown;
  onError: (cb: (message: string) => void) => unknown;
  onAck: (cb: (success: boolean) => void) => unknown;
};

export class ElectronicBoardAdapter implements ChangeDispenserPort {
  private readonly logger = new Logger(ElectronicBoardAdapter.name);
  private legacy: LegacyElectronicBoard | null = null;
  private coinReceivedHandler: ((amount: string) => void) | null = null;
  private billReceivedHandler: ((amount: string) => void) | null = null;
  private errorHandler: ((message: string) => void) | null = null;
  private pendingAckResolve: ((success: boolean) => void) | null = null;

  constructor(private readonly legacyPath: string) {}

  private resolveLegacyPath(): string {
    if (this.legacyPath.length > 0) {
      return this.legacyPath;
    }

    return join(
      process.cwd(),
      'vendor',
      'peripherals',
      'coins-tech-coins-electronic-board-1.0.6',
      'dist',
      'electronic-board',
      'electronic-board.js',
    );
  }

  private loadLegacy(): LegacyElectronicBoard {
    installVendorConsoleFilter();
    const resolvedPath = this.resolveLegacyPath();
    if (!existsSync(resolvedPath)) {
      throw new Error(`No se encontro la libreria de la placa electronica en ${resolvedPath}`);
    }

    // Node cachea require() — si el COM cambio la instancia anterior sigue con el puerto
    // viejo abierto. Limpiamos el cache para obtener una instancia completamente nueva.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    delete require.cache[require.resolve(resolvedPath)];
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const legacyModule = require(resolvedPath);
    return legacyModule.default as LegacyElectronicBoard;
  }

  async connect(port: string): Promise<boolean> {
    // Cerrar la conexion previa antes de abrir una nueva (el COM puede haber cambiado).
    if (this.legacy) {
      try {
        this.legacy.disconnect();
      } catch {
        // ignorar — la conexion anterior puede estar ya rota
      }

      // La libreria vendor (compilada, no es codigo propio) cierra el puerto
      // pero no le quita los listeners ni suelta su propia referencia interna.
      // Cada reconexion recarga el modulo completo (ver loadLegacy) — sin esto,
      // el SerialPort viejo queda con sus listeners colgando hasta que el GC
      // decida limpiarlo, y en reconexiones frecuentes (placa intermitente) eso
      // puede acumularse. Se limpia por nuestro lado antes de soltar la
      // instancia vieja, sin tocar el archivo del vendor.
      try {
        this.legacy.port?.removeAllListeners?.();
      } catch {
        // el puerto viejo puede ya estar en un estado raro — no es critico.
      }

      this.legacy = null;
    }

    this.legacy = this.loadLegacy();

    // La librería vendor hace throw dentro de callbacks de SerialPort en lugar de
    // rechazar la Promise, lo que escapa a cualquier try/catch. Se intercepta aquí.
    return new Promise<boolean>((resolve, reject) => {
      const uncaughtHandler = (error: Error) => {
        process.removeListener('uncaughtException', uncaughtHandler);
        reject(error);
      };
      process.once('uncaughtException', uncaughtHandler);

      // Register callbacks BEFORE connecting so no event fires into a void
      // during the async gap between connect() resolving and handler setup.
      if (this.errorHandler) this.legacy!.onError(this.errorHandler);
      if (this.coinReceivedHandler) this.legacy!.onCoinReceived(this.coinReceivedHandler);
      if (this.billReceivedHandler) this.legacy!.onBillReceived(this.billReceivedHandler);
      this.legacy!.onAck((success) => {
        this.pendingAckResolve?.(success);
      });

      Promise.resolve(this.legacy!.connect(port))
        .then((result) => {
          process.removeListener('uncaughtException', uncaughtHandler);
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

  activate(): void {
    this.legacy?.activate();
  }

  deactivate(): void {
    this.legacy?.deactivate();
  }

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
    const port = this.legacy?.port;
    if (!port?.isOpen) {
      throw new Error('La tarjeta electronica no esta conectada');
    }

    const command = this.buildReturnRawCommand(frameBytes, total);

    this.logger.log(
      `[BOARD][TX][RETURN] trama enviada a la placa: [${command
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join(' ')}]`,
    );

    for (const byte of command) {
      port.write([byte]);
    }
  }

  returnChange(
    returnValue: number,
    bill1Denomination: number,
    bill2Denomination: number,
    coin1Denomination: number,
    coin2Denomination: number,
  ): void {
    this.legacy?.return(
      returnValue,
      bill1Denomination,
      bill2Denomination,
      coin1Denomination,
      coin2Denomination,
    );
  }

  returnWithAck(
    frameBytes: [number, number, number, number],
    total: number,
    ackTimeoutMs = 5000,
  ): Promise<ReturnAckResult> {
    return new Promise<ReturnAckResult>((resolve) => {
      let settled = false;

      const settle = (result: ReturnAckResult) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.pendingAckResolve = null;
        resolve(result);
      };

      const timer = setTimeout(
        () => settle({ success: false, timedOut: true }),
        ackTimeoutMs,
      );

      this.pendingAckResolve = (success: boolean) =>
        settle({ success, timedOut: false });

      try {
        this.returnRaw(frameBytes, total);
      } catch {
        settle({ success: false, timedOut: false });
      }
    });
  }

  onCoinReceived(handler: (amount: string) => void): void {
    this.coinReceivedHandler = handler;
    this.legacy?.onCoinReceived(handler);
  }

  onBillReceived(handler: (amount: string) => void): void {
    this.billReceivedHandler = handler;
    this.legacy?.onBillReceived(handler);
  }

  onError(handler: (message: string) => void): void {
    this.errorHandler = handler;
    this.legacy?.onError(handler);
  }
}
