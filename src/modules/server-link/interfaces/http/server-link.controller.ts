import { Controller, Get } from '@nestjs/common';
import { LocalApiRole } from '@common/security/local-api-role.enum';
import { Roles } from '@common/security/roles.decorator';
import { ServerLinkService } from '@modules/server-link/application/server-link.service';

@Controller('server-link')
export class ServerLinkController {
  constructor(private readonly serverLinkService: ServerLinkService) {}

  @Roles(LocalApiRole.Admin, LocalApiRole.Operator, LocalApiRole.Audit)
  @Get('status')
  getStatus() {
    return this.serverLinkService.getConnectionStatus();
  }
}
