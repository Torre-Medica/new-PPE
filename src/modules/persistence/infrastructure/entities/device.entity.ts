import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum DeviceType {
  QrScanner       = 'QR_SCANNER',
  BillValidator   = 'BILL_VALIDATOR',
  CoinAcceptor    = 'COIN_ACCEPTOR',
  ChangeDispenser = 'CHANGE_DISPENSER',
  ElectronicBoard = 'ELECTRONIC_BOARD',
  DispenserBill1  = 'DISPENSER_BILL_1',
  DispenserBill2  = 'DISPENSER_BILL_2',
  DispenserCoin1  = 'DISPENSER_COIN_1',
  DispenserCoin2  = 'DISPENSER_COIN_2',
  Printer         = 'PRINTER',
}

export enum DeviceStatus {
  Disconnected = 'DISCONNECTED',
  Connecting   = 'CONNECTING',
  Connected    = 'CONNECTED',
  Error        = 'ERROR',
}

@Entity({ name: 'devices' })
export class DeviceEntity {
  @PrimaryGeneratedColumn('increment')
  id!: number;

  @Column({ type: 'varchar', unique: true })
  code!: string;

  @Column({ type: 'varchar' })
  name!: string;

  @Column({ type: 'varchar' })
  type!: DeviceType;

  @Column({ type: 'varchar' })
  driver!: string;

  @Column({ type: 'varchar', nullable: true })
  port!: string | null;

  @Column({ type: 'varchar', default: DeviceStatus.Disconnected })
  status!: DeviceStatus;

  @Column({ type: 'varchar', nullable: true, name: 'last_error' })
  lastError!: string | null;

  @Column({ type: 'datetime', nullable: true, name: 'last_heartbeat_at' })
  lastHeartbeatAt!: Date | null;

  @CreateDateColumn({ type: 'datetime', name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'datetime', name: 'updated_at' })
  updatedAt!: Date;
}
