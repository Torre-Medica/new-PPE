import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateCashIncidents1760000018000 implements MigrationInterface {
  name = 'CreateCashIncidents1760000018000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "cash_incidents" (
        "id"                integer PRIMARY KEY AUTOINCREMENT NOT NULL,
        "type"               varchar NOT NULL,
        "amount"             integer NOT NULL,
        "denomination_id"    integer,
        "payment_session_id" varchar(36),
        "note"               varchar(255),
        "created_by"         varchar(120) NOT NULL,
        "created_at"         datetime NOT NULL DEFAULT (datetime('now')),
        CONSTRAINT "FK_cash_incidents_denomination"
          FOREIGN KEY ("denomination_id")
          REFERENCES "denominations" ("id")
          ON DELETE RESTRICT
          ON UPDATE CASCADE,
        CONSTRAINT "FK_cash_incidents_payment_session"
          FOREIGN KEY ("payment_session_id")
          REFERENCES "payment_sessions" ("id")
          ON DELETE SET NULL
          ON UPDATE CASCADE
      )
    `);

    await queryRunner.query(
      `CREATE INDEX "IDX_cash_incidents_created_at" ON "cash_incidents" ("created_at")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_cash_incidents_payment_session_id" ON "cash_incidents" ("payment_session_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "cash_incidents"`);
  }
}
