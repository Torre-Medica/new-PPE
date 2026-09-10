import { CancelPaymentDto } from '@modules/server-link/application/dto/cancel-payment.dto';
import { CommitPaymentDto } from '@modules/server-link/application/dto/commit-payment.dto';
import {
  GenerateMonthlySubscriptionDto,
  MonthlySubscriptionCommitResponse,
  MonthlySubscriptionPreparation,
  ValidateMonthlySubscriptionDto,
} from '@modules/server-link/application/dto/monthly-subscription.dto';
import { ValidatePaymentDto } from '@modules/server-link/application/dto/validate-payment.dto';

export const SERVER_LINK_PORT = Symbol('ServerLinkPort');

export interface ServerLinkPort {
  validatePaymentCandidate(dto: ValidatePaymentDto): Promise<unknown>;
  commitPayment(dto: CommitPaymentDto): Promise<unknown>;
  cancelPayment(dto: CancelPaymentDto): Promise<unknown>;
  prepareMonthlySubscription(identificationCode: string): Promise<MonthlySubscriptionPreparation>;
  validateMonthlySubscription(dto: ValidateMonthlySubscriptionDto): Promise<unknown>;
  generateMonthlySubscriptionPayment(
    dto: GenerateMonthlySubscriptionDto,
    ppeTransactionUuid: string,
  ): Promise<MonthlySubscriptionCommitResponse>;
  getConnectionStatus(): Promise<{
    connected: boolean;
    url: string;
    namespace: string;
    deviceUuid: string;
  }>;
}
