import { Column, Entity, PrimaryColumn } from 'typeorm';

export type DispenserSlotKey = 'bill1' | 'bill2' | 'coin1' | 'coin2';

@Entity({ name: 'dispenser_slots' })
export class DispenserSlotEntity {
  @PrimaryColumn({ type: 'varchar', name: 'slot_key' })
  slotKey!: DispenserSlotKey;

  @Column({ type: 'integer', nullable: true, name: 'denomination_id' })
  denominationId!: number | null;

  @Column({ type: 'varchar' })
  label!: string;

  @Column({ type: 'boolean', default: true, name: 'is_active' })
  isActive!: boolean;

  @Column({ type: 'integer', default: 0 })
  quantity!: number;
}
