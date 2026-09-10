import { Column, Entity, JoinColumn, OneToOne, PrimaryColumn, UpdateDateColumn } from 'typeorm';
import { DenominationEntity } from '@modules/persistence/infrastructure/entities/denomination.entity';

@Entity({ name: 'cash_inventory' })
export class CashInventoryEntity {
  @PrimaryColumn({ type: 'integer', name: 'denomination_id' })
  denominationId!: number;

  @Column({ type: 'integer', default: 0 })
  quantity!: number;

  @Column({ type: 'integer', default: 0, name: 'min_threshold' })
  minThreshold!: number;

  @Column({ type: 'integer', default: 0, name: 'max_threshold' })
  maxThreshold!: number;

  @UpdateDateColumn({ type: 'datetime', name: 'updated_at' })
  updatedAt!: Date;

  @OneToOne(() => DenominationEntity, (denomination) => denomination.inventory, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'denomination_id' })
  denomination!: DenominationEntity;
}
