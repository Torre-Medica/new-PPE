import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { DeviceEntity } from '@modules/persistence/infrastructure/entities/device.entity';

@Entity({ name: 'device_health_logs' })
@Index('IDX_device_health_logs_device_code', ['deviceCode'])
export class DeviceHealthLogEntity {
  @PrimaryGeneratedColumn('increment')
  id!: number;

  @Column({ type: 'integer', name: 'device_id', nullable: true })
  deviceId!: number | null;

  @ManyToOne(() => DeviceEntity, { nullable: true, eager: false, onDelete: 'CASCADE', onUpdate: 'CASCADE' })
  @JoinColumn({ name: 'device_id' })
  device?: DeviceEntity;

  @Column({ type: 'varchar', name: 'device_code' })
  deviceCode!: string;

  @ManyToOne(() => DeviceEntity, { nullable: false, eager: false, onDelete: 'CASCADE', onUpdate: 'CASCADE' })
  @JoinColumn({ name: 'device_code', referencedColumnName: 'code' })
  deviceByCode?: DeviceEntity;

  @Column({ type: 'varchar' })
  level!: string;

  @Column({ type: 'varchar', length: 500 })
  message!: string;

  @CreateDateColumn({ type: 'datetime', name: 'created_at' })
  createdAt!: Date;
}
