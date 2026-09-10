import { MigrationInterface, QueryRunner } from 'typeorm';

export class EnsureCashCloseoutType1760000013000 implements MigrationInterface {
  name = 'EnsureCashCloseoutType1760000013000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const tableExists = await queryRunner.hasTable('cash_closeouts');
    if (!tableExists) {
      return;
    }

    const hasColumn = await queryRunner.hasColumn('cash_closeouts', 'closeout_type');
    if (hasColumn) {
      return;
    }

    await queryRunner.query(`
      ALTER TABLE "cash_closeouts" ADD COLUMN "closeout_type" varchar(20) NOT NULL DEFAULT 'TOTAL'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const tableExists = await queryRunner.hasTable('cash_closeouts');
    if (!tableExists) {
      return;
    }

    const hasColumn = await queryRunner.hasColumn('cash_closeouts', 'closeout_type');
    if (!hasColumn) {
      return;
    }

    await queryRunner.query(`PRAGMA foreign_keys = OFF`);

    await queryRunner.query(`
      CREATE TABLE "cash_closeouts_new" (
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
      INSERT INTO "cash_closeouts_new"
        ("id","period_started_at","period_ended_at","closed_at","closed_by","transaction_count","total_collected","notes","receipt_json","created_at")
      SELECT
        "id","period_started_at","period_ended_at","closed_at","closed_by","transaction_count","total_collected","notes","receipt_json","created_at"
      FROM "cash_closeouts"
    `);

    await queryRunner.query(`DROP TABLE "cash_closeouts"`);
    await queryRunner.query(`ALTER TABLE "cash_closeouts_new" RENAME TO "cash_closeouts"`);
    await queryRunner.query(`CREATE INDEX "IDX_cash_closeouts_closed_at" ON "cash_closeouts" ("closed_at")`);
    await queryRunner.query(`PRAGMA foreign_keys = ON`);
  }
}
