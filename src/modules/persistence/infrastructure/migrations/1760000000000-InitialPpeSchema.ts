import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitialPpeSchema1760000000000 implements MigrationInterface {
  name = 'InitialPpeSchema1760000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "denominations" (
        "id" integer PRIMARY KEY NOT NULL,
        "kind" varchar NOT NULL,
        "currency" varchar NOT NULL DEFAULT ('COP'),
        "is_active" boolean NOT NULL DEFAULT (1)
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "cash_inventory" (
        "denomination_id" integer PRIMARY KEY NOT NULL,
        "quantity" integer NOT NULL DEFAULT (0),
        "min_threshold" integer NOT NULL DEFAULT (0),
        "max_threshold" integer NOT NULL DEFAULT (0),
        "updated_at" datetime NOT NULL DEFAULT (datetime('now')),
        CONSTRAINT "FK_cash_inventory_denomination"
          FOREIGN KEY ("denomination_id")
          REFERENCES "denominations" ("id")
          ON DELETE CASCADE
          ON UPDATE RESTRICT
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "payment_sessions" (
        "id" varchar PRIMARY KEY NOT NULL,
        "server_process_id" integer,
        "server_payment_id" integer,
        "server_sync_status" varchar NOT NULL DEFAULT ('PENDING'),
        "qr_code" varchar(512),
        "vehicle_plate" varchar(16),
        "vehicle_type" varchar(32),
        "identification_type" varchar(32),
        "identification_code" varchar(128),
        "concept" varchar(120),
        "target_amount" integer NOT NULL,
        "inserted_amount" integer NOT NULL DEFAULT (0),
        "change_amount" integer NOT NULL DEFAULT (0),
        "status" varchar NOT NULL,
        "started_at" datetime NOT NULL,
        "completed_at" datetime,
        "failure_reason" varchar,
        "metadata_json" text,
        "created_at" datetime NOT NULL DEFAULT (datetime('now')),
        "updated_at" datetime NOT NULL DEFAULT (datetime('now'))
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "payment_lines" (
        "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
        "payment_session_id" varchar(36) NOT NULL,
        "denomination_id" integer NOT NULL,
        "quantity" integer NOT NULL,
        "subtotal" integer NOT NULL,
        CONSTRAINT "FK_payment_lines_session"
          FOREIGN KEY ("payment_session_id")
          REFERENCES "payment_sessions" ("id")
          ON DELETE CASCADE
          ON UPDATE CASCADE,
        CONSTRAINT "FK_payment_lines_denomination"
          FOREIGN KEY ("denomination_id")
          REFERENCES "denominations" ("id")
          ON DELETE RESTRICT
          ON UPDATE RESTRICT
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "payment_session_events" (
        "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
        "payment_session_id" varchar(36) NOT NULL,
        "type" varchar NOT NULL,
        "amount" integer,
        "payload_json" text,
        "created_at" datetime NOT NULL DEFAULT (datetime('now')),
        CONSTRAINT "FK_payment_session_events_session"
          FOREIGN KEY ("payment_session_id")
          REFERENCES "payment_sessions" ("id")
          ON DELETE CASCADE
          ON UPDATE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "server_sync_attempts" (
        "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
        "payment_session_id" varchar(36) NOT NULL,
        "request_type" varchar NOT NULL,
        "request_json" text NOT NULL,
        "response_json" text,
        "status" varchar NOT NULL,
        "created_at" datetime NOT NULL DEFAULT (datetime('now')),
        CONSTRAINT "FK_server_sync_attempts_session"
          FOREIGN KEY ("payment_session_id")
          REFERENCES "payment_sessions" ("id")
          ON DELETE CASCADE
          ON UPDATE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "cash_movements" (
        "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
        "type" varchar NOT NULL,
        "denomination_id" integer NOT NULL,
        "quantity" integer NOT NULL,
        "unit_value" integer NOT NULL,
        "total_value" integer NOT NULL,
        "reason" varchar(255) NOT NULL,
        "payment_session_id" varchar(36),
        "created_by" varchar(120) NOT NULL,
        "created_at" datetime NOT NULL DEFAULT (datetime('now')),
        CONSTRAINT "FK_cash_movements_denomination"
          FOREIGN KEY ("denomination_id")
          REFERENCES "denominations" ("id")
          ON DELETE RESTRICT
          ON UPDATE RESTRICT,
        CONSTRAINT "FK_cash_movements_session"
          FOREIGN KEY ("payment_session_id")
          REFERENCES "payment_sessions" ("id")
          ON DELETE SET NULL
          ON UPDATE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "devices" (
        "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
        "code" varchar NOT NULL UNIQUE,
        "name" varchar NOT NULL,
        "type" varchar NOT NULL,
        "driver" varchar NOT NULL,
        "port" varchar,
        "status" varchar NOT NULL DEFAULT ('DISCONNECTED'),
        "metadata_json" text,
        "last_error" varchar,
        "last_heartbeat_at" datetime,
        "created_at" datetime NOT NULL DEFAULT (datetime('now')),
        "updated_at" datetime NOT NULL DEFAULT (datetime('now'))
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "device_health_logs" (
        "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
        "device_code" varchar NOT NULL,
        "level" varchar NOT NULL,
        "message" varchar(500) NOT NULL,
        "created_at" datetime NOT NULL DEFAULT (datetime('now'))
      )
    `);

    await queryRunner.query(`CREATE INDEX "IDX_payment_sessions_qr_code" ON "payment_sessions" ("qr_code")`);
    await queryRunner.query(`CREATE INDEX "IDX_payment_sessions_status" ON "payment_sessions" ("status")`);
    await queryRunner.query(`CREATE INDEX "IDX_payment_sessions_completed_at" ON "payment_sessions" ("completed_at")`);
    await queryRunner.query(`CREATE INDEX "IDX_payment_sessions_server_payment_id" ON "payment_sessions" ("server_payment_id")`);
    await queryRunner.query(`CREATE INDEX "IDX_payment_lines_session_id" ON "payment_lines" ("payment_session_id")`);
    await queryRunner.query(`CREATE INDEX "IDX_payment_lines_denomination_id" ON "payment_lines" ("denomination_id")`);
    await queryRunner.query(`CREATE INDEX "IDX_payment_session_events_session_id" ON "payment_session_events" ("payment_session_id")`);
    await queryRunner.query(`CREATE INDEX "IDX_server_sync_attempts_session_id" ON "server_sync_attempts" ("payment_session_id")`);
    await queryRunner.query(`CREATE INDEX "IDX_cash_movements_created_at" ON "cash_movements" ("created_at")`);
    await queryRunner.query(`CREATE INDEX "IDX_cash_movements_denomination_id" ON "cash_movements" ("denomination_id")`);
    await queryRunner.query(`CREATE INDEX "IDX_cash_movements_session_id" ON "cash_movements" ("payment_session_id")`);
    await queryRunner.query(`CREATE INDEX "IDX_device_health_logs_device_code" ON "device_health_logs" ("device_code")`);

    await queryRunner.query(`
      CREATE TRIGGER "trg_payment_sessions_updated_at"
      AFTER UPDATE ON "payment_sessions"
      FOR EACH ROW
      BEGIN
        UPDATE "payment_sessions"
        SET "updated_at" = datetime('now')
        WHERE "id" = OLD."id";
      END
    `);

    await queryRunner.query(`
      CREATE TRIGGER "trg_devices_updated_at"
      AFTER UPDATE ON "devices"
      FOR EACH ROW
      BEGIN
        UPDATE "devices"
        SET "updated_at" = datetime('now')
        WHERE "id" = OLD."id";
      END
    `);

    await queryRunner.query(`
      CREATE TRIGGER "trg_cash_inventory_updated_at"
      AFTER UPDATE ON "cash_inventory"
      FOR EACH ROW
      BEGIN
        UPDATE "cash_inventory"
        SET "updated_at" = datetime('now')
        WHERE "denomination_id" = OLD."denomination_id";
      END
    `);

    await queryRunner.query(`
      INSERT INTO "denominations" ("id", "kind", "currency", "is_active") VALUES
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
      INSERT INTO "cash_inventory" ("denomination_id", "quantity", "min_threshold", "max_threshold") VALUES
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
      INSERT INTO "devices" (
        "code", "name", "type", "driver", "port", "status",
        "metadata_json", "last_error", "last_heartbeat_at"
      ) VALUES
      ('QR_SCANNER',      'Lector QR',               'QR_SCANNER',      'LEGACY', NULL, 'DISCONNECTED', NULL, NULL, NULL),
      ('BILL_VALIDATOR',  'Validador de billetes',    'BILL_VALIDATOR',  'LEGACY', NULL, 'DISCONNECTED', NULL, NULL, NULL),
      ('COIN_ACCEPTOR',   'Aceptador de monedas',     'COIN_ACCEPTOR',   'LEGACY', NULL, 'DISCONNECTED', NULL, NULL, NULL),
      ('CHANGE_DISPENSER','Dispensador de cambio',    'CHANGE_DISPENSER','LEGACY', NULL, 'DISCONNECTED', NULL, NULL, NULL),
      ('ELECTRONIC_BOARD','Tarjeta electronica',      'ELECTRONIC_BOARD','LEGACY', NULL, 'DISCONNECTED', NULL, NULL, NULL)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TRIGGER IF EXISTS "trg_cash_inventory_updated_at"`);
    await queryRunner.query(`DROP TRIGGER IF EXISTS "trg_devices_updated_at"`);
    await queryRunner.query(`DROP TRIGGER IF EXISTS "trg_payment_sessions_updated_at"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_device_health_logs_device_code"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_cash_movements_created_at"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_server_sync_attempts_session_id"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_payment_session_events_session_id"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_payment_lines_session_id"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_payment_lines_denomination_id"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_payment_sessions_server_payment_id"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_payment_sessions_completed_at"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_payment_sessions_status"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_payment_sessions_qr_code"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_cash_movements_session_id"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_cash_movements_denomination_id"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "device_health_logs"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "devices"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "cash_movements"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "server_sync_attempts"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "payment_session_events"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "payment_lines"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "payment_sessions"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "cash_inventory"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "denominations"`);
  }
}
