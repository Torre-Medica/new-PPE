import { MigrationInterface, QueryRunner } from 'typeorm';

export class EnsureBaselineOperationalData1760000014000 implements MigrationInterface {
  name = 'EnsureBaselineOperationalData1760000014000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT OR IGNORE INTO "denominations" ("id", "kind", "currency", "is_active") VALUES
      (50, 'COIN', 'COP', 1),
      (100, 'COIN', 'COP', 1),
      (200, 'COIN', 'COP', 1),
      (500, 'COIN', 'COP', 1),
      (1000, 'BILL', 'COP', 1),
      (2000, 'BILL', 'COP', 1),
      (5000, 'BILL', 'COP', 1),
      (10000, 'BILL', 'COP', 1),
      (20000, 'BILL', 'COP', 1),
      (50000, 'BILL', 'COP', 1)
    `);

    await queryRunner.query(`
      INSERT OR IGNORE INTO "cash_inventory" ("denomination_id", "quantity", "min_threshold", "max_threshold") VALUES
      (50, 0, 0, 0),
      (100, 0, 0, 0),
      (200, 0, 0, 0),
      (500, 0, 0, 0),
      (1000, 0, 0, 0),
      (2000, 0, 0, 0),
      (5000, 0, 0, 0),
      (10000, 0, 0, 0),
      (20000, 0, 0, 0),
      (50000, 0, 0, 0)
    `);

    await queryRunner.query(`
      INSERT OR IGNORE INTO "devices" (
        "code", "name", "type", "driver", "port", "status",
        "last_error", "last_heartbeat_at"
      ) VALUES
      ('QR_SCANNER', 'Lector QR', 'QR_SCANNER', 'LEGACY', NULL, 'DISCONNECTED', NULL, NULL),
      ('BILL_VALIDATOR', 'Validador de billetes', 'BILL_VALIDATOR', 'LEGACY', NULL, 'DISCONNECTED', NULL, NULL),
      ('COIN_ACCEPTOR', 'Aceptador de monedas', 'COIN_ACCEPTOR', 'LEGACY', NULL, 'DISCONNECTED', NULL, NULL),
      ('CHANGE_DISPENSER', 'Dispensador de cambio', 'CHANGE_DISPENSER', 'LEGACY', NULL, 'DISCONNECTED', NULL, NULL),
      ('ELECTRONIC_BOARD', 'Tarjeta electronica', 'ELECTRONIC_BOARD', 'LEGACY', NULL, 'DISCONNECTED', NULL, NULL),
      ('PRINTER', 'Impresora termica', 'PRINTER', 'USB_LP', NULL, 'DISCONNECTED', NULL, NULL)
    `);

    await queryRunner.query(`
      INSERT OR IGNORE INTO "dispenser_slots" ("slot_key", "denomination_id", "label", "is_active", "quantity") VALUES
      ('bill1', 10000, 'Dispensador billetes 1 - $10.000', 1, 0),
      ('bill2', 2000, 'Dispensador billetes 2 - $2.000', 1, 0),
      ('coin1', 500, 'Monedero bus 1 - $500', 1, 0),
      ('coin2', 100, 'Monedero bus 2 - $100', 1, 0)
    `);

    await queryRunner.query(`
      UPDATE "dispenser_slots"
      SET "label" = CASE "slot_key"
        WHEN 'bill1' THEN 'Dispensador billetes 1 - $10.000'
        WHEN 'bill2' THEN 'Dispensador billetes 2 - $2.000'
        WHEN 'coin1' THEN 'Monedero bus 1 - $500'
        WHEN 'coin2' THEN 'Monedero bus 2 - $100'
        ELSE "label"
      END
      WHERE "slot_key" IN ('bill1', 'bill2', 'coin1', 'coin2')
    `);

    await queryRunner.query(`
      INSERT OR IGNORE INTO "kiosk_state" ("id", "mode", "updated_by")
      VALUES (1, 'PAYMENT', 'migration')
    `);
  }

  public async down(): Promise<void> {
    // No-op: esta migracion solo refuerza baseline operativo idempotente.
  }
}
