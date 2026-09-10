import { existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  DeviceEntity,
  DeviceStatus,
} from '@modules/persistence/infrastructure/entities/device.entity';

const LINUX_USB_PATHS = [
  '/dev/usb/lp0',
  '/dev/usb/lp1',
  '/dev/lp0',
  '/dev/lp1',
];

type PrinterCheckResult = {
  connected: boolean;
  port: string | null;
  lastError?: string | null;
};

@Injectable()
export class PrinterDetectorService {
  private readonly logger = new Logger(PrinterDetectorService.name);

  constructor(
    @InjectRepository(DeviceEntity)
    private readonly deviceRepo: Repository<DeviceEntity>,
    private readonly configService: ConfigService,
  ) {}

  async detect(): Promise<void> {
    const { connected, port, lastError } = this.checkPrinter();

    const status = connected ? DeviceStatus.Connected : DeviceStatus.Disconnected;
    const result = await this.deviceRepo.update(
      { code: 'PRINTER' },
      { status, port: port ?? null, lastError: lastError ?? null },
    );

    if (result.affected && result.affected > 0) {
      if (connected) {
        this.logger.log(`Impresora detectada en ${port} -> CONNECTED`);
      } else {
        this.logger.warn(
          `Impresora no detectada -> DISCONNECTED${lastError ? ` (${lastError})` : ''}`,
        );
      }
    }
  }

  private checkPrinter(): PrinterCheckResult {
    if (this.configService.get<boolean>('peripherals.simulateHardware', false)) {
      const printerName = this.configService.get<string>('printing.printerName')?.trim() || 'printer';
      this.logger.log(`[SIMULADO] Impresora conectada como ${printerName}`);
      return { connected: true, port: `SIMULATED:${printerName}` };
    }

    if (process.platform === 'linux') {
      for (const devicePath of LINUX_USB_PATHS) {
        if (existsSync(devicePath)) {
          return { connected: true, port: devicePath };
        }
      }

      try {
        const output = execSync('lpstat -p 2>/dev/null', { timeout: 2000 }).toString();
        const lines = output.split('\n').filter((line) => line.startsWith('printer '));
        if (lines.length > 0) {
          const name = lines[0].split(' ')[1] ?? 'cups';
          const connected = !lines[0].includes('disabled');
          return {
            connected,
            port: `CUPS:${name}`,
            lastError: connected ? null : 'La impresora CUPS aparece deshabilitada',
          };
        }
      } catch {
        return { connected: false, port: null, lastError: 'lpstat no disponible o sin impresoras' };
      }

      return { connected: false, port: null, lastError: 'No se detecto impresora USB o CUPS' };
    }

    if (process.platform === 'win32') {
      return this.checkWindowsPrinter();
    }

    return { connected: false, port: null, lastError: 'Sistema operativo no soportado' };
  }

  private checkWindowsPrinter(): PrinterCheckResult {
    const configuredPrinterName =
      this.configService.get<string>('printing.printerName')?.trim() || 'printer';
    const escapedPrinterName = configuredPrinterName.replace(/'/g, "''");

    const command =
      `$ErrorActionPreference='Stop'; ` +
      `$target='${escapedPrinterName}'; ` +
      `$configured = Get-CimInstance Win32_Printer | Where-Object { $_.Name -eq $target } | ` +
      `Select-Object -First 1 Name,PortName,WorkOffline,PrinterStatus,Default; ` +
      `if ($configured) { $configured | ConvertTo-Json -Compress; exit 0 }; ` +
      `$fallback = Get-CimInstance Win32_Printer | Where-Object { $_.Default -eq $true } | ` +
      `Select-Object -First 1 Name,PortName,WorkOffline,PrinterStatus,Default; ` +
      `if ($fallback) { $fallback | ConvertTo-Json -Compress; exit 0 }; ` +
      `exit 1`;

    try {
      const output = execSync(`powershell -NoProfile -Command "${command}"`, {
        timeout: 5000,
      })
        .toString()
        .trim();

      if (!output) {
        return { connected: false, port: null, lastError: 'PowerShell no devolvio impresora' };
      }

      const printer = JSON.parse(output) as {
        Name?: string;
        PortName?: string;
        WorkOffline?: boolean;
        PrinterStatus?: number;
        Default?: boolean;
      };

      if (printer.WorkOffline) {
        return {
          connected: false,
          port: printer.PortName ?? printer.Name ?? null,
          lastError: `La impresora '${printer.Name ?? configuredPrinterName}' aparece en modo offline`,
        };
      }

      return {
        connected: true,
        port: printer.PortName ?? printer.Name ?? configuredPrinterName,
        lastError: null,
      };
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      return {
        connected: false,
        port: null,
        lastError: `No fue posible consultar Win32_Printer: ${detail}`,
      };
    }
  }
}
