import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { CashCloseoutEntity } from '@modules/persistence/infrastructure/entities/cash-closeout.entity';
import { DenominationEntity } from '@modules/persistence/infrastructure/entities/denomination.entity';

@Entity({ name: 'cash_closeout_lines' })
@Index('IDX_cash_closeout_lines_closeout_id', ['closeoutId'])
@Index('IDX_cash_closeout_lines_denomination_id', ['denominationId'])
export class CashCloseoutLineEntity {
  @PrimaryGeneratedColumn('increment')
  id!: number;

  @Column({ type: 'integer', name: 'closeout_id' })
  closeoutId!: number;

  @Column({ type: 'integer', name: 'denomination_id' })
  denominationId!: number;

  @Column({ type: 'integer' })
  quantity!: number;

  @Column({ type: 'integer' })
  subtotal!: number;

  @ManyToOne(() => CashCloseoutEntity, (closeout) => closeout.lines, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'closeout_id' })
  closeout!: CashCloseoutEntity;

  @ManyToOne(() => DenominationEntity, {
    eager: true,
    onDelete: 'RESTRICT',
  })
  @JoinColumn({ name: 'denomination_id' })
  denomination!: DenominationEntity;
}
