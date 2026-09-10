import { Controller, Get, Query } from '@nestjs/common';
import { LocalApiRole } from '@common/security/local-api-role.enum';
import { Roles } from '@common/security/roles.decorator';
import { QueryDeviceHealthDto } from '@modules/audit/application/dto/query-device-health.dto';
import { QueryPaymentEventsDto } from '@modules/audit/application/dto/query-payment-events.dto';
import { QueryServerSyncAttemptsDto } from '@modules/audit/application/dto/query-server-sync-attempts.dto';
import { AuditService } from '@modules/audit/application/audit.service';

@Controller('audit')
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  @Roles(LocalApiRole.Admin, LocalApiRole.Audit)
  @Get('payment-events')
  getRecentPaymentEvents(@Query() query: QueryPaymentEventsDto) {
    return this.auditService.getRecentPaymentEvents(query);
  }

  @Roles(LocalApiRole.Admin, LocalApiRole.Audit)
  @Get('device-health')
  getRecentDeviceHealth(@Query() query: QueryDeviceHealthDto) {
    return this.auditService.getRecentDeviceHealthLogs(query);
  }

  @Roles(LocalApiRole.Admin, LocalApiRole.Audit)
  @Get('server-sync-attempts')
  getServerSyncAttempts(@Query() query: QueryServerSyncAttemptsDto) {
    return this.auditService.getServerSyncAttempts(query);
  }
}
