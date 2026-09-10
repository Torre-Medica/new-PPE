import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { CashMovementEntity } from '@modules/persistence/infrastructure/entities/cash-movement.entity';
import { PaymentLineEntity } from '@modules/persistence/infrastructure/entities/payment-line.entity';
import { PaymentSessionEventEntity } from '@modules/persistence/infrastructure/entities/payment-session-event.entity';
import { ServerSyncAttemptEntity } from '@modules/persistence/infrastructure/entities/server-sync-attempt.entity';

export enum PaymentSessionStatus {
  Created = 'CREATED',
  Validating = 'VALIDATING',
  Validated = 'VALIDATED',
  ListeningCash = 'LISTENING_CASH',
  ChangePending = 'CHANGE_PENDING',
  DispensingChange = 'DISPENSING_CHANGE',
  ReadyToCommit = 'READY_TO_COMMIT',
  CommittingToServer = 'COMMITTING_TO_SERVER',
  Completed = 'COMPLETED',
  CompletedWithWarning = 'COMPLETED_WITH_WARNING',
  Canceled = 'CANCELED',
  Failed = 'FAILED',
  Timeout = 'TIMEOUT',
}

export enum ServerSyncStatus {
  Pending = 'PENDING',
  Confirmed = 'CONFIRMED',
  Rejected = 'REJECTED',
}

@Entity({ name: 'payment_sessions' })
@Index('IDX_payment_sessions_qr_code', ['qrCode'])
@Index('IDX_payment_sessions_status', ['status'])
@Index('IDX_payment_sessions_completed_at', ['completedAt'])
@Index('IDX_payment_sessions_server_payment_id', ['serverPaymentId'])
export class PaymentSessionEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'integer', nullable: true, name: 'server_process_id' })
  serverProcessId!: number | null;

  @Column({ type: 'integer', nullable: true, name: 'server_payment_id' })
  serverPaymentId!: number | null;

  @Column({ type: 'varchar', default: ServerSyncStatus.Pending, name: 'server_sync_status' })
  serverSyncStatus!: ServerSyncStatus;

  @Column({ type: 'varchar', length: 512, nullable: true, name: 'qr_code' })
  qrCode!: string | null;

  @Column({ type: 'varchar', length: 16, nullable: true, name: 'vehicle_plate' })
  vehiclePlate!: string | null;

  @Column({ type: 'varchar', length: 32, nullable: true, name: 'vehicle_type' })
  vehicleType!: string | null;

  @Column({ type: 'varchar', length: 32, nullable: true, name: 'identification_type' })
  identificationType!: string | null;

  @Column({ type: 'varchar', length: 128, nullable: true, name: 'identification_code' })
  identificationCode!: string | null;

  @Column({ type: 'varchar', length: 120, nullable: true })
  concept!: string | null;

  @Column({ type: 'integer', name: 'target_amount' })
  targetAmount!: number;

  @Column({ type: 'integer', default: 0, name: 'inserted_amount' })
  insertedAmount!: number;

  @Column({ type: 'integer', default: 0, name: 'change_amount' })
  changeAmount!: number;

  @Column({ type: 'varchar' })
  status!: PaymentSessionStatus;

  @Column({ type: 'datetime', name: 'started_at' })
  startedAt!: Date;

  @Column({ type: 'datetime', nullable: true, name: 'completed_at' })
  completedAt!: Date | null;

  @Column({ type: 'varchar', nullable: true, name: 'failure_reason' })
  failureReason!: string | null;

  @Column({ type: 'text', nullable: true, name: 'metadata_json' })
  metadataJson!: string | null;

  @Column({ type: 'text', nullable: true, name: 'change_commands_json' })
  changeCommandsJson!: string | null;

  @CreateDateColumn({ type: 'datetime', name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'datetime', name: 'updated_at' })
  updatedAt!: Date;

  @OneToMany(() => PaymentLineEntity, (line) => line.paymentSession)
  paymentLines!: PaymentLineEntity[];

  @OneToMany(() => PaymentSessionEventEntity, (event) => event.paymentSession)
  events!: PaymentSessionEventEntity[];

  @OneToMany(() => ServerSyncAttemptEntity, (attempt) => attempt.paymentSession)
  syncAttempts!: ServerSyncAttemptEntity[];

  @OneToMany(() => CashMovementEntity, (movement) => movement.paymentSession)
  cashMovements!: CashMovementEntity[];
}
