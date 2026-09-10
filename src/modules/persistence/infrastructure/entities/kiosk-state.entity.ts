import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

export enum KioskMode {
  Payment = 'PAYMENT',
  Maintenance = 'MAINTENANCE',
}

@Entity({ name: 'kiosk_state' })
export class KioskStateEntity {
  @PrimaryColumn({ type: 'integer' })
  id!: number;

  @Column({ type: 'varchar', default: KioskMode.Payment })
  mode!: KioskMode;

  @Column({ type: 'boolean', default: false, name: 'payments_blocked' })
  paymentsBlocked!: boolean;

  @Column({ type: 'varchar', nullable: true, name: 'block_reason' })
  blockReason!: string | null;

  @Column({ type: 'varchar', nullable: true, name: 'updated_by' })
  updatedBy!: string | null;

  @UpdateDateColumn({ type: 'datetime', name: 'updated_at' })
  updatedAt!: Date;
}
