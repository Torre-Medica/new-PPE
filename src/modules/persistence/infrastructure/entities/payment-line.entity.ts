import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { DenominationEntity } from '@modules/persistence/infrastructure/entities/denomination.entity';
import { PaymentSessionEntity } from '@modules/persistence/infrastructure/entities/payment-session.entity';

@Entity({ name: 'payment_lines' })
@Index('IDX_payment_lines_session_id', ['paymentSessionId'])
export class PaymentLineEntity {
  @PrimaryGeneratedColumn('increment')
  id!: number;

  @Column({ type: 'varchar', length: 36, name: 'payment_session_id' })
  paymentSessionId!: string;

  @Column({ type: 'integer', name: 'denomination_id' })
  denominationId!: number;

  @Column({ type: 'integer' })
  quantity!: number;

  @Column({ type: 'integer' })
  subtotal!: number;

  @ManyToOne(() => PaymentSessionEntity, (session) => session.paymentLines, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'payment_session_id' })
  paymentSession!: PaymentSessionEntity;

  @ManyToOne(() => DenominationEntity, (denomination) => denomination.paymentLines, {
    eager: true,
    onDelete: 'RESTRICT',
  })
  @JoinColumn({ name: 'denomination_id' })
  denomination!: DenominationEntity;
}
