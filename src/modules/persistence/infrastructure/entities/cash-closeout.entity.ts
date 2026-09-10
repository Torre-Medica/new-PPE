import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { CashCloseoutLineEntity } from '@modules/persistence/infrastructure/entities/cash-closeout-line.entity';

export type CashCloseoutType = 'PARTIAL' | 'TOTAL';

@Entity({ name: 'cash_closeouts' })
@Index('IDX_cash_closeouts_closed_at', ['closedAt'])
export class CashCloseoutEntity {
  @PrimaryGeneratedColumn('increment')
  id!: number;

  @Column({ type: 'datetime', name: 'period_started_at' })
  periodStartedAt!: Date;

  @Column({ type: 'datetime', name: 'period_ended_at' })
  periodEndedAt!: Date;

  @Column({ type: 'datetime', name: 'closed_at' })
  closedAt!: Date;

  @Column({ type: 'varchar', length: 120, name: 'closed_by' })
  closedBy!: string;

  @Column({ type: 'varchar', length: 20, name: 'closeout_type', default: 'TOTAL' })
  closeoutType!: CashCloseoutType;

  @Column({ type: 'integer', name: 'transaction_count', default: 0 })
  transactionCount!: number;

  @Column({ type: 'integer', name: 'total_collected', default: 0 })
  totalCollected!: number;

  /**
   * Snapshot del total en tolvas (dispenser_slots) al momento del cierre. Es la
   * unica fuente de "tolvas inicial" que puede leer el siguiente cierre sin
   * tener que parsear receipt_json.
   */
  @Column({ type: 'integer', name: 'hopper_total', default: 0 })
  hopperTotal!: number;

  @Column({ type: 'varchar', length: 255, nullable: true })
  notes!: string | null;

  @Column({ type: 'text', nullable: true, name: 'receipt_json' })
  receiptJson!: string | null;

  @CreateDateColumn({ type: 'datetime', name: 'created_at' })
  createdAt!: Date;

  @OneToMany(() => CashCloseoutLineEntity, (line) => line.closeout, {
    cascade: false,
  })
  lines!: CashCloseoutLineEntity[];
}
