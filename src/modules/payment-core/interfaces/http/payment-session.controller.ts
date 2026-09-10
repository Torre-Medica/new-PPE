import { Body, Controller, Get, Param, Post, Query, UseFilters } from '@nestjs/common';
import { DomainExceptionFilter } from '@common/errors/domain-exception.filter';
import { LocalApiRole } from '@common/security/local-api-role.enum';
import { Roles } from '@common/security/roles.decorator';
import { ActivatePaymentCollectionDto } from '@modules/payment-core/application/dto/activate-payment-collection.dto';
import { CompleteSessionDto } from '@modules/payment-core/application/dto/complete-session.dto';
import { QueryCompletedPaymentsDto } from '@modules/payment-core/application/dto/query-completed-payments.dto';
import { RegisterCashDto } from '@modules/payment-core/application/dto/register-cash.dto';
import { RetryPendingCommitsDto } from '@modules/payment-core/application/dto/retry-pending-commits.dto';
import { StartPaymentSessionDto } from '@modules/payment-core/application/dto/start-payment-session.dto';
import { ValidateMonthlySubscriptionPlateDto } from '@modules/payment-core/application/dto/validate-monthly-subscription-plate.dto';
import { PaymentSessionService } from '@modules/payment-core/application/payment-session.service';

@UseFilters(DomainExceptionFilter)
@Controller('payments')
export class PaymentSessionController {
  constructor(
    private readonly paymentSessionService: PaymentSessionService,
  ) {}

  @Roles(LocalApiRole.Admin, LocalApiRole.Operator)
  @Post('start')
  startSession(@Body() dto: StartPaymentSessionDto) {
    return this.paymentSessionService.startSession(dto);
  }

  @Roles(LocalApiRole.Admin, LocalApiRole.Operator)
  @Post('cancel/:id')
  cancelSession(@Param('id') sessionId: string) {
    return this.paymentSessionService.cancelSession(sessionId);
  }

  @Roles(LocalApiRole.Admin, LocalApiRole.Operator)
  @Post(':id/collect')
  activateCollection(
    @Param('id') sessionId: string,
    @Body() dto: ActivatePaymentCollectionDto,
  ) {
    return this.paymentSessionService.activateCollection(sessionId, dto);
  }

  @Roles(LocalApiRole.Admin, LocalApiRole.Operator)
  @Post(':id/monthly-subscription/validate')
  validateMonthlySubscriptionPlate(
    @Param('id') sessionId: string,
    @Body() dto: ValidateMonthlySubscriptionPlateDto,
  ) {
    return this.paymentSessionService.validateMonthlySubscriptionPlate(
      sessionId,
      dto,
    );
  }

  @Roles(LocalApiRole.Admin, LocalApiRole.Operator)
  @Post(':id/cash')
  registerCash(
    @Param('id') sessionId: string,
    @Body() dto: RegisterCashDto,
  ) {
    return this.paymentSessionService.registerCash(sessionId, dto);
  }

  @Roles(LocalApiRole.Admin, LocalApiRole.Operator)
  @Post(':id/complete')
  completeSession(
    @Param('id') sessionId: string,
    @Body() dto: CompleteSessionDto,
  ) {
    return this.paymentSessionService.completeSession(sessionId, dto);
  }

  @Roles(LocalApiRole.Admin, LocalApiRole.Operator)
  @Post('sync/retry')
  retryPendingCommits(@Body() dto: RetryPendingCommitsDto) {
    return this.paymentSessionService.retryPendingCommits(dto);
  }

  @Roles(LocalApiRole.Admin, LocalApiRole.Operator, LocalApiRole.Audit)
  @Get('completed/search')
  listCompletedPayments(@Query() query: QueryCompletedPaymentsDto) {
    return this.paymentSessionService.listCompletedPayments(query);
  }

  @Roles(LocalApiRole.Admin, LocalApiRole.Operator, LocalApiRole.Audit)
  @Get('completed/by-qr/:qrCode')
  getCompletedByQr(@Param('qrCode') qrCode: string) {
    return this.paymentSessionService.getCompletedPaymentByQrCode(qrCode);
  }

  @Roles(LocalApiRole.Admin, LocalApiRole.Operator, LocalApiRole.Audit)
  @Get('active')
  getActiveSession() {
    return this.paymentSessionService.getActiveSessionSummary();
  }

  @Roles(LocalApiRole.Admin, LocalApiRole.Operator, LocalApiRole.Audit)
  @Get(':id/events')
  getSessionEvents(@Param('id') sessionId: string) {
    return this.paymentSessionService.getSessionEvents(sessionId);
  }

  @Roles(LocalApiRole.Admin, LocalApiRole.Operator, LocalApiRole.Audit)
  @Get(':id')
  getSession(@Param('id') sessionId: string) {
    return this.paymentSessionService.getSessionById(sessionId);
  }
}
