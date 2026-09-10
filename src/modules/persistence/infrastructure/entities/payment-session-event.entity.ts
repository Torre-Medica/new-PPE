import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { PaymentSessionEntity } from '@modules/persistence/infrastructure/entities/payment-session.entity';

@Entity({ name: 'payment_session_events' })
@Index('IDX_payment_session_events_session_id', ['paymentSessionId'])
export class PaymentSessionEventEntity {
  @PrimaryGeneratedColumn('increment')
  id!: number;

  @Column({ type: 'varchar', length: 36, name: 'payment_session_id' })
  paymentSessionId!: string;

  @Column({ type: 'varchar' })
  type!: string;

  @Column({ type: 'integer', nullable: true })
  amount!: number | null;

  @Column({ type: 'text', nullable: true, name: 'payload_json' })
  payloadJson!: string | null;

  @CreateDateColumn({ type: 'datetime', name: 'created_at' })
  createdAt!: Date;

  @ManyToOne(() => PaymentSessionEntity, (session) => session.events, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'payment_session_id' })
  paymentSession!: PaymentSessionEntity;
}
