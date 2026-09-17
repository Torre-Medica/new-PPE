import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PrintingService } from '@modules/printing/application/printing.service';
import { CashCloseoutEntity } from '@modules/persistence/infrastructure/entities/cash-closeout.entity';
import { PaymentSessionEntity } from '@modules/persistence/infrastructure/entities/payment-session.entity';
import { ServerLinkModule } from '@modules/server-link/server-link.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([PaymentSessionEntity, CashCloseoutEntity]),
    forwardRef(() => ServerLinkModule),
  ],
  providers: [PrintingService],
  exports: [PrintingService],
})
export class PrintingModule {}
