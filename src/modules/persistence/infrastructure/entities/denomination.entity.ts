import { Column, Entity, OneToMany, OneToOne, PrimaryColumn } from 'typeorm';
import { CashInventoryEntity } from '@modules/persistence/infrastructure/entities/cash-inventory.entity';
import { CashMovementEntity } from '@modules/persistence/infrastructure/entities/cash-movement.entity';
import { PaymentLineEntity } from '@modules/persistence/infrastructure/entities/payment-line.entity';

export enum DenominationKind {
  Bill = 'BILL',
  Coin = 'COIN',
}

@Entity({ name: 'denominations' })
export class DenominationEntity {
  @PrimaryColumn({ type: 'integer' })
  id!: number;

  @Column({ type: 'varchar' })
  kind!: DenominationKind;

  @Column({ type: 'varchar', default: 'COP' })
  currency!: string;

  @Column({ type: 'boolean', default: true, name: 'is_active' })
  isActive!: boolean;

  @OneToOne(() => CashInventoryEntity, (inventory) => inventory.denomination)
  inventory!: CashInventoryEntity;

  @OneToMany(() => CashMovementEntity, (movement) => movement.denomination)
  movements!: CashMovementEntity[];

  @OneToMany(() => PaymentLineEntity, (line) => line.denomination)
  paymentLines!: PaymentLineEntity[];
}
