import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { appConfig } from '@common/config/app.config';
import { envValidationSchema } from '@common/config/env.validation';
import { DatabaseBackupService } from '@common/services/database-backup.service';
import { LocalApiAuthGuard } from '@common/security/local-api-auth.guard';
import { AuditModule } from '@modules/audit/audit.module';
import { AuthModule } from '@modules/auth/auth.module';
import { CashManagementModule } from '@modules/cash-management/cash-management.module';
import { KioskModule } from '@modules/kiosk/kiosk.module';
import { LocalApiModule } from '@modules/local-api/local-api.module';
import { PaymentCoreModule } from '@modules/payment-core/payment-core.module';
import { PeripheralsModule } from '@modules/peripherals/peripherals.module';
import { PersistenceModule } from '@modules/persistence/persistence.module';
import { PrintingModule } from '@modules/printing/printing.module';
import { ServerLinkModule } from '@modules/server-link/server-link.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [appConfig],
      validationSchema: envValidationSchema,
      validationOptions: {
        allowUnknown: true,
        abortEarly: false,
      },
    }),
    PersistenceModule,
    AuthModule,
    AuditModule,
    CashManagementModule,
    KioskModule,
    PaymentCoreModule,
    PeripheralsModule,
    PrintingModule,
    ServerLinkModule,
    LocalApiModule,
  ],
  providers: [
    DatabaseBackupService,
    {
      provide: APP_GUARD,
      useClass: LocalApiAuthGuard,
    },
  ],
})
export class AppModule {}
