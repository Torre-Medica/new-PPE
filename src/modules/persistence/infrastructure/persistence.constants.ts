import { CashInventoryEntity } from '@modules/persistence/infrastructure/entities/cash-inventory.entity';
import { CashCloseoutEntity } from '@modules/persistence/infrastructure/entities/cash-closeout.entity';
import { CashCloseoutLineEntity } from '@modules/persistence/infrastructure/entities/cash-closeout-line.entity';
import { CashIncidentEntity } from '@modules/persistence/infrastructure/entities/cash-incident.entity';
import { CashMovementEntity } from '@modules/persistence/infrastructure/entities/cash-movement.entity';
import { DenominationEntity } from '@modules/persistence/infrastructure/entities/denomination.entity';
import { DeviceHealthLogEntity } from '@modules/persistence/infrastructure/entities/device-health-log.entity';
import { DeviceEntity } from '@modules/persistence/infrastructure/entities/device.entity';
import { DispenserSlotEntity } from '@modules/persistence/infrastructure/entities/dispenser-slot.entity';
import { PaymentLineEntity } from '@modules/persistence/infrastructure/entities/payment-line.entity';
import { PaymentSessionEventEntity } from '@modules/persistence/infrastructure/entities/payment-session-event.entity';
import { PaymentSessionEntity } from '@modules/persistence/infrastructure/entities/payment-session.entity';
import { ServerSyncAttemptEntity } from '@modules/persistence/infrastructure/entities/server-sync-attempt.entity';
import { KioskStateEntity } from '@modules/persistence/infrastructure/entities/kiosk-state.entity';

export const persistenceEntities = [
  DenominationEntity,
  CashInventoryEntity,
  CashCloseoutEntity,
  CashCloseoutLineEntity,
  PaymentSessionEntity,
  PaymentLineEntity,
  PaymentSessionEventEntity,
  ServerSyncAttemptEntity,
  CashMovementEntity,
  CashIncidentEntity,
  DeviceEntity,
  DeviceHealthLogEntity,
  DispenserSlotEntity,
  KioskStateEntity,
];
