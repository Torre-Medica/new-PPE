import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPhysicalForeignKeys1760000003000
  implements MigrationInterface
{
  name = 'AddPhysicalForeignKeys1760000003000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`PRAGMA foreign_keys = OFF`);

    await queryRunner.query(`
      CREATE TABLE "cash_inventory_new" (
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
      INSERT INTO "cash_inventory_new" (
        "denomination_id", "quantity", "min_threshold", "max_threshold", "updated_at"
      )
      SELECT
        "denomination_id", "quantity", "min_threshold", "max_threshold", "updated_at"
      FROM "cash_inventory"
    `);

    await queryRunner.query(`
      CREATE TABLE "cash_movements_new" (
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
      INSERT INTO "cash_movements_new" (
        "id", "type", "denomination_id", "quantity", "unit_value", "total_value",
        "reason", "payment_session_id", "created_by", "created_at"
      )
      SELECT
        "id", "type", "denomination_id", "quantity", "unit_value", "total_value",
        "reason", "payment_session_id", "created_by", "created_at"
      FROM "cash_movements"
    `);

    await queryRunner.query(`
      CREATE TABLE "payment_lines_new" (
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
      INSERT INTO "payment_lines_new" (
        "id", "payment_session_id", "denomination_id", "quantity", "subtotal"
      )
      SELECT
        "id", "payment_session_id", "denomination_id", "quantity", "subtotal"
      FROM "payment_lines"
    `);

    await queryRunner.query(`
      CREATE TABLE "payment_session_events_new" (
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
      INSERT INTO "payment_session_events_new" (
        "id", "payment_session_id", "type", "amount", "payload_json", "created_at"
      )
      SELECT
        "id", "payment_session_id", "type", "amount", "payload_json", "created_at"
      FROM "payment_session_events"
    `);

    await queryRunner.query(`
      CREATE TABLE "server_sync_attempts_new" (
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
      INSERT INTO "server_sync_attempts_new" (
        "id", "payment_session_id", "request_type", "request_json", "response_json", "status", "created_at"
      )
      SELECT
        "id", "payment_session_id", "request_type", "request_json", "response_json", "status", "created_at"
      FROM "server_sync_attempts"
    `);

    await queryRunner.query(`DROP TRIGGER IF EXISTS "trg_cash_inventory_updated_at"`);
    await queryRunner.query(`DROP TABLE "cash_inventory"`);
    await queryRunner.query(`DROP TABLE "cash_movements"`);
    await queryRunner.query(`DROP TABLE "payment_lines"`);
    await queryRunner.query(`DROP TABLE "payment_session_events"`);
    await queryRunner.query(`DROP TABLE "server_sync_attempts"`);

    await queryRunner.query(`ALTER TABLE "cash_inventory_new" RENAME TO "cash_inventory"`);
    await queryRunner.query(`ALTER TABLE "cash_movements_new" RENAME TO "cash_movements"`);
    await queryRunner.query(`ALTER TABLE "payment_lines_new" RENAME TO "payment_lines"`);
    await queryRunner.query(`ALTER TABLE "payment_session_events_new" RENAME TO "payment_session_events"`);
    await queryRunner.query(`ALTER TABLE "server_sync_attempts_new" RENAME TO "server_sync_attempts"`);

    await queryRunner.query(`CREATE INDEX "IDX_payment_lines_session_id" ON "payment_lines" ("payment_session_id")`);
    await queryRunner.query(`CREATE INDEX "IDX_payment_lines_denomination_id" ON "payment_lines" ("denomination_id")`);
    await queryRunner.query(`CREATE INDEX "IDX_payment_session_events_session_id" ON "payment_session_events" ("payment_session_id")`);
    await queryRunner.query(`CREATE INDEX "IDX_server_sync_attempts_session_id" ON "server_sync_attempts" ("payment_session_id")`);
    await queryRunner.query(`CREATE INDEX "IDX_cash_movements_created_at" ON "cash_movements" ("created_at")`);
    await queryRunner.query(`CREATE INDEX "IDX_cash_movements_denomination_id" ON "cash_movements" ("denomination_id")`);
    await queryRunner.query(`CREATE INDEX "IDX_cash_movements_session_id" ON "cash_movements" ("payment_session_id")`);

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

    await queryRunner.query(`PRAGMA foreign_keys = ON`);
    await queryRunner.query(`PRAGMA foreign_key_check`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`PRAGMA foreign_keys = OFF`);

    await queryRunner.query(`
      CREATE TABLE "cash_inventory_old" (
        "denomination_id" integer PRIMARY KEY NOT NULL,
        "quantity" integer NOT NULL DEFAULT (0),
        "min_threshold" integer NOT NULL DEFAULT (0),
        "max_threshold" integer NOT NULL DEFAULT (0),
        "updated_at" datetime NOT NULL DEFAULT (datetime('now'))
      )
    `);

    await queryRunner.query(`
      INSERT INTO "cash_inventory_old" (
        "denomination_id", "quantity", "min_threshold", "max_threshold", "updated_at"
      )
      SELECT
        "denomination_id", "quantity", "min_threshold", "max_threshold", "updated_at"
      FROM "cash_inventory"
    `);

    await queryRunner.query(`
      CREATE TABLE "cash_movements_old" (
        "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
        "type" varchar NOT NULL,
        "denomination_id" integer NOT NULL,
        "quantity" integer NOT NULL,
        "unit_value" integer NOT NULL,
        "total_value" integer NOT NULL,
        "reason" varchar(255) NOT NULL,
        "payment_session_id" varchar(36),
        "created_by" varchar(120) NOT NULL,
        "created_at" datetime NOT NULL DEFAULT (datetime('now'))
      )
    `);

    await queryRunner.query(`
      INSERT INTO "cash_movements_old" (
        "id", "type", "denomination_id", "quantity", "unit_value", "total_value",
        "reason", "payment_session_id", "created_by", "created_at"
      )
      SELECT
        "id", "type", "denomination_id", "quantity", "unit_value", "total_value",
        "reason", "payment_session_id", "created_by", "created_at"
      FROM "cash_movements"
    `);

    await queryRunner.query(`
      CREATE TABLE "payment_lines_old" (
        "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
        "payment_session_id" varchar(36) NOT NULL,
        "denomination_id" integer NOT NULL,
        "quantity" integer NOT NULL,
        "subtotal" integer NOT NULL
      )
    `);

    await queryRunner.query(`
      INSERT INTO "payment_lines_old" (
        "id", "payment_session_id", "denomination_id", "quantity", "subtotal"
      )
      SELECT
        "id", "payment_session_id", "denomination_id", "quantity", "subtotal"
      FROM "payment_lines"
    `);

    await queryRunner.query(`
      CREATE TABLE "payment_session_events_old" (
        "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
        "payment_session_id" varchar(36) NOT NULL,
        "type" varchar NOT NULL,
        "amount" integer,
        "payload_json" text,
        "created_at" datetime NOT NULL DEFAULT (datetime('now'))
      )
    `);

    await queryRunner.query(`
      INSERT INTO "payment_session_events_old" (
        "id", "payment_session_id", "type", "amount", "payload_json", "created_at"
      )
      SELECT
        "id", "payment_session_id", "type", "amount", "payload_json", "created_at"
      FROM "payment_session_events"
    `);

    await queryRunner.query(`
      CREATE TABLE "server_sync_attempts_old" (
        "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
        "payment_session_id" varchar(36) NOT NULL,
        "request_type" varchar NOT NULL,
        "request_json" text NOT NULL,
        "response_json" text,
        "status" varchar NOT NULL,
        "created_at" datetime NOT NULL DEFAULT (datetime('now'))
      )
    `);

    await queryRunner.query(`
      INSERT INTO "server_sync_attempts_old" (
        "id", "payment_session_id", "request_type", "request_json", "response_json", "status", "created_at"
      )
      SELECT
        "id", "payment_session_id", "request_type", "request_json", "response_json", "status", "created_at"
      FROM "server_sync_attempts"
    `);

    await queryRunner.query(`DROP TRIGGER IF EXISTS "trg_cash_inventory_updated_at"`);
    await queryRunner.query(`DROP TABLE "cash_inventory"`);
    await queryRunner.query(`DROP TABLE "cash_movements"`);
    await queryRunner.query(`DROP TABLE "payment_lines"`);
    await queryRunner.query(`DROP TABLE "payment_session_events"`);
    await queryRunner.query(`DROP TABLE "server_sync_attempts"`);

    await queryRunner.query(`ALTER TABLE "cash_inventory_old" RENAME TO "cash_inventory"`);
    await queryRunner.query(`ALTER TABLE "cash_movements_old" RENAME TO "cash_movements"`);
    await queryRunner.query(`ALTER TABLE "payment_lines_old" RENAME TO "payment_lines"`);
    await queryRunner.query(`ALTER TABLE "payment_session_events_old" RENAME TO "payment_session_events"`);
    await queryRunner.query(`ALTER TABLE "server_sync_attempts_old" RENAME TO "server_sync_attempts"`);

    await queryRunner.query(`CREATE INDEX "IDX_payment_lines_session_id" ON "payment_lines" ("payment_session_id")`);
    await queryRunner.query(`CREATE INDEX "IDX_payment_session_events_session_id" ON "payment_session_events" ("payment_session_id")`);
    await queryRunner.query(`CREATE INDEX "IDX_server_sync_attempts_session_id" ON "server_sync_attempts" ("payment_session_id")`);
    await queryRunner.query(`CREATE INDEX "IDX_cash_movements_created_at" ON "cash_movements" ("created_at")`);

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

    await queryRunner.query(`PRAGMA foreign_keys = ON`);
  }
}
