import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SerialPort } from 'serialport';
import { DeviceEntity } from '@modules/persistence/infrastructure/entities/device.entity';

export interface PortResolveOptions {
  vendorId?: string;
  productId?: string;
  fallbackPort?: string;
  deviceName: string;
  /** Código del dispositivo en la tabla `devices` para actualizar su columna `port` al resolver */
  deviceCode?: string;
}

@Injectable()
export class PortResolverService {
  private readonly logger = new Logger(PortResolverService.name);

  constructor(
    @InjectRepository(DeviceEntity)
    private readonly deviceRepository: Repository<DeviceEntity>,
  ) {}

  /**
   * Resuelve el puerto COM por USB VID/PID primero, luego cae al puerto explícito.
   * Si se proporciona `deviceCode`, actualiza `devices.port` con el puerto encontrado.
   */
  async resolve(options: PortResolveOptions): Promise<string | null> {
    const { vendorId, productId, fallbackPort, deviceName, deviceCode } = options;
    let resolved: string | null = null;

    if (vendorId) {
      try {
        const ports = await SerialPort.list();
        const match = ports.find(
          (p) =>
            p.vendorId?.toLowerCase() === vendorId.toLowerCase() &&
            (!productId || p.productId?.toLowerCase() === productId.toLowerCase()),
        );

        if (match) {
          this.logger.log(
            `[PortResolver] ${deviceName} → ${match.path} (VID:${match.vendorId} PID:${match.productId})`,
          );
          resolved = match.path;
        } else {
          this.logger.warn(
            `[PortResolver] ${deviceName} no encontrado por VID:${vendorId}/PID:${productId ?? '*'}`,
          );
        }
      } catch (err) {
        this.logger.warn(
          `[PortResolver] Error listando puertos: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    if (!resolved && fallbackPort) {
      this.logger.log(`[PortResolver] ${deviceName} → ${fallbackPort} (fallback por config)`);
      resolved = fallbackPort;
    }

    if (resolved && deviceCode) {
      await this.updateDevicePort(deviceCode, resolved);
    }

    return resolved;
  }

  /** Lista todos los puertos disponibles — útil para diagnóstico. */
  async listAll(): Promise<
    Array<{ path: string; vendorId?: string; productId?: string; manufacturer?: string; pnpId?: string }>
  > {
    const ports = await SerialPort.list();
    return ports.map((p) => ({
      path: p.path,
      vendorId: p.vendorId,
      productId: p.productId,
      manufacturer: p.manufacturer,
      pnpId: p.pnpId,
    }));
  }

  private async updateDevicePort(deviceCode: string, port: string): Promise<void> {
    try {
      await this.deviceRepository.update({ code: deviceCode }, { port });
    } catch (err) {
      this.logger.warn(
        `[PortResolver] No se pudo actualizar devices.port para ${deviceCode}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
