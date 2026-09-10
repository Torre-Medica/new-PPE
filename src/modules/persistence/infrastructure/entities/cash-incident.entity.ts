import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { DenominationEntity } from '@modules/persistence/infrastructure/entities/denomination.entity';
import { PaymentSessionEntity } from '@modules/persistence/infrastructure/entities/payment-session.entity';

export enum CashIncidentType {
  RejectedLargeBill = 'REJECTED_LARGE_BILL',
  UndispensableChange = 'UNDISPENSABLE_CHANGE',
  UnconfirmedDispense = 'UNCONFIRMED_DISPENSE',
}

@Entity({ name: 'cash_incidents' })
@Index('IDX_cash_incidents_created_at', ['createdAt'])
export class CashIncidentEntity {
  @PrimaryGeneratedColumn('increment')
  id!: number;

  @Column({ type: 'varchar' })
  type!: CashIncidentType;

  @Column({ type: 'integer' })
  amount!: number;

  @Column({ type: 'integer', nullable: true, name: 'denomination_id' })
  denominationId!: number | null;

  @Column({ type: 'varchar', length: 36, nullable: true, name: 'payment_session_id' })
  paymentSessionId!: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  note!: string | null;

  @Column({ type: 'varchar', length: 120, name: 'created_by' })
  createdBy!: string;

  @CreateDateColumn({ type: 'datetime', name: 'created_at' })
  createdAt!: Date;

  @ManyToOne(() => DenominationEntity, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'denomination_id' })
  denomination!: DenominationEntity | null;

  @ManyToOne(() => PaymentSessionEntity, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'payment_session_id' })
  paymentSession!: PaymentSessionEntity | null;
}
