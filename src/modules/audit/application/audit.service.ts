import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsWhere, Repository } from 'typeorm';
import { QueryDeviceHealthDto } from '@modules/audit/application/dto/query-device-health.dto';
import { QueryPaymentEventsDto } from '@modules/audit/application/dto/query-payment-events.dto';
import { QueryServerSyncAttemptsDto } from '@modules/audit/application/dto/query-server-sync-attempts.dto';
import { DeviceHealthLogEntity } from '@modules/persistence/infrastructure/entities/device-health-log.entity';
import { PaymentSessionEventEntity } from '@modules/persistence/infrastructure/entities/payment-session-event.entity';
import { ServerSyncAttemptEntity } from '@modules/persistence/infrastructure/entities/server-sync-attempt.entity';

@Injectable()
export class AuditService {
  constructor(
    @InjectRepository(PaymentSessionEventEntity)
    private readonly paymentSessionEventRepository: Repository<PaymentSessionEventEntity>,
    @InjectRepository(DeviceHealthLogEntity)
    private readonly deviceHealthLogRepository: Repository<DeviceHealthLogEntity>,
    @InjectRepository(ServerSyncAttemptEntity)
    private readonly serverSyncAttemptRepository: Repository<ServerSyncAttemptEntity>,
  ) {}

  async getRecentPaymentEvents(query: QueryPaymentEventsDto) {
    const where: FindOptionsWhere<PaymentSessionEventEntity> = {};
    if (query.paymentSessionId) {
      where.paymentSessionId = query.paymentSessionId;
    }

    if (query.type) {
      where.type = query.type;
    }

    return this.paymentSessionEventRepository.find({
      where,
      order: {
        createdAt: 'DESC',
        id: 'DESC',
      },
      take: query.limit ?? 200,
    });
  }

  async getRecentDeviceHealthLogs(query: QueryDeviceHealthDto) {
    const where: FindOptionsWhere<DeviceHealthLogEntity> = {};
    if (query.deviceCode) {
      where.deviceCode = query.deviceCode;
    }

    return this.deviceHealthLogRepository.find({
      where,
      order: {
        createdAt: 'DESC',
        id: 'DESC',
      },
      take: query.limit ?? 200,
    });
  }

  async getServerSyncAttempts(query: QueryServerSyncAttemptsDto) {
    const where: FindOptionsWhere<ServerSyncAttemptEntity> = {};
    if (query.paymentSessionId) {
      where.paymentSessionId = query.paymentSessionId;
    }

    if (query.requestType) {
      where.requestType = query.requestType;
    }

    if (query.status) {
      where.status = query.status;
    }

    return this.serverSyncAttemptRepository.find({
      where,
      order: {
        createdAt: 'DESC',
        id: 'DESC',
      },
      take: query.limit ?? 200,
    });
  }
}
