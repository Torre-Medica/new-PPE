import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPaymentSessionChangeCommands1760000015000 implements MigrationInterface {
  name = 'AddPaymentSessionChangeCommands1760000015000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "payment_sessions"
      ADD COLUMN "change_commands_json" text
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "payment_sessions_rollback" (
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
      INSERT INTO "payment_sessions_rollback" (
        "id", "server_process_id", "server_payment_id", "server_sync_status",
        "qr_code", "vehicle_plate", "vehicle_type", "identification_type",
        "identification_code", "concept", "target_amount", "inserted_amount",
        "change_amount", "status", "started_at", "completed_at",
        "failure_reason", "metadata_json", "created_at", "updated_at"
      )
      SELECT
        "id", "server_process_id", "server_payment_id", "server_sync_status",
        "qr_code", "vehicle_plate", "vehicle_type", "identification_type",
        "identification_code", "concept", "target_amount", "inserted_amount",
        "change_amount", "status", "started_at", "completed_at",
        "failure_reason", "metadata_json", "created_at", "updated_at"
      FROM "payment_sessions"
    `);

    await queryRunner.query(`DROP TABLE "payment_sessions"`);
    await queryRunner.query(`ALTER TABLE "payment_sessions_rollback" RENAME TO "payment_sessions"`);
    await queryRunner.query(`CREATE INDEX "IDX_payment_sessions_qr_code" ON "payment_sessions" ("qr_code")`);
    await queryRunner.query(`CREATE INDEX "IDX_payment_sessions_status" ON "payment_sessions" ("status")`);
    await queryRunner.query(`CREATE INDEX "IDX_payment_sessions_completed_at" ON "payment_sessions" ("completed_at")`);
    await queryRunner.query(`CREATE INDEX "IDX_payment_sessions_server_payment_id" ON "payment_sessions" ("server_payment_id")`);
  }
}
