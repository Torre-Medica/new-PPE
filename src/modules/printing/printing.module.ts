import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PrintingService } from '@modules/printing/application/printing.service';
import { CashCloseoutEntity } from '@modules/persistence/infrastructure/entities/cash-closeout.entity';
import { PaymentSessionEntity } from '@modules/persistence/infrastructure/entities/payment-session.entity';

@Module({
  imports: [TypeOrmModule.forFeature([PaymentSessionEntity, CashCloseoutEntity])],
  providers: [PrintingService],
  exports: [PrintingService],
})
export class PrintingModule {}
