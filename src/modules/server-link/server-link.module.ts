import { forwardRef, Module } from '@nestjs/common';
import { KioskModule } from '@modules/kiosk/kiosk.module';
import { ServerLinkService } from '@modules/server-link/application/server-link.service';
import { NexoBackRestService } from '@modules/server-link/application/nexo-back-rest.service';
import { ElectronicBillingController } from '@modules/server-link/interfaces/http/electronic-billing.controller';
import { ServerLinkController } from '@modules/server-link/interfaces/http/server-link.controller';
import { SERVER_LINK_PORT } from '@modules/server-link/domain/ports/server-link.port';

@Module({
  imports: [forwardRef(() => KioskModule)],
  controllers: [ServerLinkController, ElectronicBillingController],
  providers: [
    NexoBackRestService,
    ServerLinkService,
    { provide: SERVER_LINK_PORT, useExisting: ServerLinkService },
  ],
  exports: [NexoBackRestService, ServerLinkService, SERVER_LINK_PORT],
})
export class ServerLinkModule {}
