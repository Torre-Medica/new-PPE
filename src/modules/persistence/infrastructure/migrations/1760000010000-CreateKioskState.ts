import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateKioskState1760000010000 implements MigrationInterface {
  name = 'CreateKioskState1760000010000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "kiosk_state" (
        "id" integer NOT NULL,
        "mode" varchar NOT NULL DEFAULT 'PAYMENT',
        "updated_by" varchar,
        "updated_at" datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      INSERT OR IGNORE INTO "kiosk_state" ("id", "mode", "updated_by")
      VALUES (1, 'PAYMENT', 'migration')
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "kiosk_state"`);
  }
}
