import { Body, Controller, Get, Param, Post, Sse } from '@nestjs/common';
import type { MessageEvent } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Observable } from 'rxjs';
import { Public } from '@common/security/public.decorator';
import { KioskEventsService } from '@modules/kiosk/application/kiosk-events.service';
import { KioskStateService } from '@modules/kiosk/application/kiosk-state.service';
import { UpdateKioskModeDto } from '@modules/kiosk/application/dto/update-kiosk-mode.dto';
import { ActivatePaymentCollectionDto } from '@modules/payment-core/application/dto/activate-payment-collection.dto';
import { CompleteSessionDto } from '@modules/payment-core/application/dto/complete-session.dto';
import { RegisterCashDto } from '@modules/payment-core/application/dto/register-cash.dto';
import { StartPaymentSessionDto } from '@modules/payment-core/application/dto/start-payment-session.dto';
import { PaymentSessionService } from '@modules/payment-core/application/payment-session.service';
import { PrintingService } from '@modules/printing/application/printing.service';

@Controller('kiosk')
export class KioskController {
  constructor(
    private readonly kioskStateService: KioskStateService,
    private readonly kioskEventsService: KioskEventsService,
    private readonly paymentSessionService: PaymentSessionService,
    private readonly printingService: PrintingService,
    private readonly configService: ConfigService,
  ) {}

  @Public()
  @Get('state')
  async getState() {
    const state = await this.kioskStateService.getState();

    return {
      ...state,
      features: {
        electronicBillingEnabled: this.configService.get<boolean>(
          'features.electronicBillingEnabled',
          false,
        ),
        monthlySubscriptionsEnabled: this.configService.get<boolean>(
          'features.monthlySubscriptionsEnabled',
          false,
        ),
      },
    };
  }

  @Public()
  @Get('active-session')
  getActiveSession() {
    return this.paymentSessionService.getActiveSessionSummary();
  }

  @Public()
  @Sse('events')
  streamEvents(): Observable<MessageEvent> {
    return this.kioskEventsService.getEventStream();
  }

  @Public()
  @Post('mode')
  async setMode(@Body() dto: UpdateKioskModeDto) {
    return this.kioskStateService.setMode(dto.mode, dto.changedBy ?? 'kiosk-selector');
  }

  @Public()
  @Post('payment-sessions/:id/collect')
  activateCollection(
    @Param('id') sessionId: string,
    @Body() dto: ActivatePaymentCollectionDto,
  ) {
    return this.paymentSessionService.activateCollection(sessionId, dto);
  }

  @Public()
  @Post('payment-sessions/:id/cancel')
  cancelSession(@Param('id') sessionId: string) {
    return this.paymentSessionService.cancelSession(sessionId);
  }

  @Public()
  @Post('payment-sessions/:id/touch')
  touchSession(@Param('id') sessionId: string) {
    return this.paymentSessionService.touchSessionActivity(sessionId);
  }

  @Public()
  @Post('payment-sessions/:id/print-receipt')
  printReceipt(@Param('id') sessionId: string) {
    return this.printingService.printPaymentReceipt(sessionId);
  }

  @Public()
  @Post('sim/start')
  startSimulatedSession(@Body() dto: StartPaymentSessionDto) {
    return this.paymentSessionService.startSession(dto);
  }

  @Public()
  @Post('sim/payment-sessions/:id/collect')
  activateSimulatedCollection(
    @Param('id') sessionId: string,
    @Body() dto: ActivatePaymentCollectionDto,
  ) {
    return this.paymentSessionService.activateSimulatedCollection(sessionId, dto);
  }

  @Public()
  @Post('sim/payment-sessions/:id/cash')
  registerSimulatedCash(
    @Param('id') sessionId: string,
    @Body() dto: RegisterCashDto,
  ) {
    return this.paymentSessionService.registerCash(sessionId, dto);
  }

  @Public()
  @Post('sim/payment-sessions/:id/complete')
  completeSimulatedSession(
    @Param('id') sessionId: string,
    @Body() dto: CompleteSessionDto,
  ) {
    return this.paymentSessionService.completeSession(sessionId, dto);
  }

  @Public()
  @Post('sim/payment-sessions/:id/cancel')
  cancelSimulatedSession(@Param('id') sessionId: string) {
    return this.paymentSessionService.cancelSession(sessionId);
  }
}
