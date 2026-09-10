import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConnectDeviceDto } from '@modules/peripherals/application/dto/connect-device.dto';
import { PeripheralsService } from '@modules/peripherals/application/peripherals.service';
import { DeviceEntity } from '@modules/persistence/infrastructure/entities/device.entity';

@Injectable()
export class DevicesService {
  constructor(
    @InjectRepository(DeviceEntity)
    private readonly deviceRepository: Repository<DeviceEntity>,
    private readonly peripheralsService: PeripheralsService,
  ) {}

  async getDevices() {
    return this.deviceRepository.find({
      order: {
        code: 'ASC',
      },
    });
  }

  async connectDevice(dto: ConnectDeviceDto) {
    await this.peripheralsService.connectDevice(dto);
    return this.getDevices();
  }

  async connectAll() {
    await this.peripheralsService.connectAll();
    return this.getDevices();
  }

  async disconnectAll() {
    await this.peripheralsService.disconnectAll();
    return this.getDevices();
  }

  getLastQrScan() {
    return this.peripheralsService.getLastQrScan();
  }
}
