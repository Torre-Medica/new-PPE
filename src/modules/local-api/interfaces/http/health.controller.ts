import { Controller, Get } from '@nestjs/common';
import { Public } from '@common/security/public.decorator';
import { LocalApiRole } from '@common/security/local-api-role.enum';
import { Roles } from '@common/security/roles.decorator';
import { PortResolverService } from '@modules/peripherals/infrastructure/port-resolver.service';

@Controller('health')
export class HealthController {
  constructor(private readonly portResolver: PortResolverService) {}

  @Public()
  @Get('live')
  getLiveness() {
    return {
      status: 'ok',
      service: 'ppe-backend',
      timestamp: new Date().toISOString(),
    };
  }

  @Public()
  @Get('ready')
  getReadiness() {
    return {
      status: 'ready',
      service: 'ppe-backend',
      timestamp: new Date().toISOString(),
    };
  }

  @Roles(LocalApiRole.Admin, LocalApiRole.Operator, LocalApiRole.Audit)
  @Get('ports')
  async getPorts() {
    const ports = await this.portResolver.listAll();
    return { timestamp: new Date().toISOString(), ports };
  }
}
