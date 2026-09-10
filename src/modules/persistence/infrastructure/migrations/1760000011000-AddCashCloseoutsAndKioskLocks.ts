import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCashCloseoutsAndKioskLocks1760000011000 implements MigrationInterface {
  name = 'AddCashCloseoutsAndKioskLocks1760000011000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "kiosk_state"
      ADD COLUMN "payments_blocked" boolean NOT NULL DEFAULT 0
    `);

    await queryRunner.query(`
      ALTER TABLE "kiosk_state"
      ADD COLUMN "block_reason" varchar
    `);

    await queryRunner.query(`
      CREATE TABLE "cash_closeouts" (
        "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
        "period_started_at" datetime NOT NULL,
        "period_ended_at" datetime NOT NULL,
        "closed_at" datetime NOT NULL,
        "closed_by" varchar(120) NOT NULL,
        "transaction_count" integer NOT NULL DEFAULT 0,
        "total_collected" integer NOT NULL DEFAULT 0,
        "notes" varchar(255),
        "receipt_json" text,
        "created_at" datetime NOT NULL DEFAULT (datetime('now'))
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_cash_closeouts_closed_at"
      ON "cash_closeouts" ("closed_at")
    `);

    await queryRunner.query(`
      CREATE TABLE "cash_closeout_lines" (
        "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
        "closeout_id" integer NOT NULL,
        "denomination_id" integer NOT NULL,
        "quantity" integer NOT NULL,
        "subtotal" integer NOT NULL,
        CONSTRAINT "FK_cash_closeout_lines_closeout"
          FOREIGN KEY ("closeout_id") REFERENCES "cash_closeouts" ("id")
          ON DELETE CASCADE ON UPDATE NO ACTION,
        CONSTRAINT "FK_cash_closeout_lines_denomination"
          FOREIGN KEY ("denomination_id") REFERENCES "denominations" ("id")
          ON DELETE RESTRICT ON UPDATE NO ACTION
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_cash_closeout_lines_closeout_id"
      ON "cash_closeout_lines" ("closeout_id")
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_cash_closeout_lines_denomination_id"
      ON "cash_closeout_lines" ("denomination_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_cash_closeout_lines_denomination_id"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_cash_closeout_lines_closeout_id"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "cash_closeout_lines"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_cash_closeouts_closed_at"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "cash_closeouts"`);

    await queryRunner.query(`
      CREATE TABLE "kiosk_state_old" (
        "id" integer PRIMARY KEY NOT NULL,
        "mode" varchar NOT NULL DEFAULT 'PAYMENT',
        "updated_by" varchar,
        "updated_at" datetime NOT NULL DEFAULT (datetime('now'))
      )
    `);

    await queryRunner.query(`
      INSERT INTO "kiosk_state_old" ("id", "mode", "updated_by", "updated_at")
      SELECT "id", "mode", "updated_by", "updated_at"
      FROM "kiosk_state"
    `);

    await queryRunner.query(`DROP TABLE "kiosk_state"`);
    await queryRunner.query(`ALTER TABLE "kiosk_state_old" RENAME TO "kiosk_state"`);
  }
}
