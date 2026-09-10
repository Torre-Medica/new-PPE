import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { DenominationEntity } from '@modules/persistence/infrastructure/entities/denomination.entity';
import { PaymentSessionEntity } from '@modules/persistence/infrastructure/entities/payment-session.entity';

export enum CashMovementType {
  Load = 'LOAD',
  Unload = 'UNLOAD',
  Accepted = 'ACCEPTED',
  Dispensed = 'DISPENSED',
  Adjustment = 'ADJUSTMENT',
}

@Entity({ name: 'cash_movements' })
@Index('IDX_cash_movements_created_at', ['createdAt'])
export class CashMovementEntity {
  @PrimaryGeneratedColumn('increment')
  id!: number;

  @Column({ type: 'varchar' })
  type!: CashMovementType;

  @Column({ type: 'integer', name: 'denomination_id' })
  denominationId!: number;

  @Column({ type: 'integer' })
  quantity!: number;

  /**
   * Slot de tolva (bill1/bill2/coin1/coin2) cuando el movimiento LOAD/UNLOAD
   * corresponde a una recarga/descargue de tolva de dispensado, no a la caja
   * recolectora (cash_inventory). Null para todo lo demas.
   */
  @Column({ type: 'varchar', length: 16, nullable: true, name: 'slot_key' })
  slotKey!: string | null;

  @Column({ type: 'integer', name: 'unit_value' })
  unitValue!: number;

  @Column({ type: 'integer', name: 'total_value' })
  totalValue!: number;

  @Column({ type: 'varchar', length: 255 })
  reason!: string;

  @Column({ type: 'varchar', length: 36, nullable: true, name: 'payment_session_id' })
  paymentSessionId!: string | null;

  @Column({ type: 'varchar', length: 120, name: 'created_by' })
  createdBy!: string;

  @CreateDateColumn({ type: 'datetime', name: 'created_at' })
  createdAt!: Date;

  @ManyToOne(() => DenominationEntity, (denomination) => denomination.movements, {
    eager: true,
    onDelete: 'RESTRICT',
  })
  @JoinColumn({ name: 'denomination_id' })
  denomination!: DenominationEntity;

  @ManyToOne(() => PaymentSessionEntity, (session) => session.cashMovements, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'payment_session_id' })
  paymentSession!: PaymentSessionEntity | null;
}
