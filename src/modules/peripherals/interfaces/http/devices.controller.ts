import { Body, Controller, Get, Post } from '@nestjs/common';
import { LocalApiRole } from '@common/security/local-api-role.enum';
import { Roles } from '@common/security/roles.decorator';
import { ConnectDeviceDto } from '@modules/peripherals/application/dto/connect-device.dto';
import { DevicesService } from '@modules/peripherals/application/devices.service';

@Controller('devices')
export class DevicesController {
  constructor(private readonly devicesService: DevicesService) {}

  @Roles(LocalApiRole.Admin, LocalApiRole.Operator, LocalApiRole.Audit)
  @Get()
  getDevices() {
    return this.devicesService.getDevices();
  }

  @Roles(LocalApiRole.Admin, LocalApiRole.Operator, LocalApiRole.Audit)
  @Get('qr/last-scan')
  getLastQrScan() {
    return this.devicesService.getLastQrScan();
  }

  @Roles(LocalApiRole.Admin, LocalApiRole.Operator)
  @Post('connect')
  connectDevice(@Body() dto: ConnectDeviceDto) {
    return this.devicesService.connectDevice(dto);
  }

  @Roles(LocalApiRole.Admin, LocalApiRole.Operator)
  @Post('connect-all')
  connectAll() {
    return this.devicesService.connectAll();
  }

  @Roles(LocalApiRole.Admin, LocalApiRole.Operator)
  @Post('disconnect-all')
  disconnectAll() {
    return this.devicesService.disconnectAll();
  }
}
