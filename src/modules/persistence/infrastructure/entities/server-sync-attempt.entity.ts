import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { PaymentSessionEntity } from '@modules/persistence/infrastructure/entities/payment-session.entity';

export enum ServerSyncAttemptType {
  Validate = 'VALIDATE',
  Commit = 'COMMIT',
  Cancel = 'CANCEL',
}

export enum ServerSyncAttemptStatus {
  Success = 'SUCCESS',
  Failed = 'FAILED',
}

@Entity({ name: 'server_sync_attempts' })
@Index('IDX_server_sync_attempts_session_id', ['paymentSessionId'])
export class ServerSyncAttemptEntity {
  @PrimaryGeneratedColumn('increment')
  id!: number;

  @Column({ type: 'varchar', length: 36, name: 'payment_session_id' })
  paymentSessionId!: string;

  @Column({ type: 'varchar', name: 'request_type' })
  requestType!: ServerSyncAttemptType;

  @Column({ type: 'text', name: 'request_json' })
  requestJson!: string;

  @Column({ type: 'text', nullable: true, name: 'response_json' })
  responseJson!: string | null;

  @Column({ type: 'varchar' })
  status!: ServerSyncAttemptStatus;

  @CreateDateColumn({ type: 'datetime', name: 'created_at' })
  createdAt!: Date;

  @ManyToOne(() => PaymentSessionEntity, (session) => session.syncAttempts, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'payment_session_id' })
  paymentSession!: PaymentSessionEntity;
}
