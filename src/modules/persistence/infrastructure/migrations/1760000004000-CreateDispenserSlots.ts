import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateDispenserSlots1760000004000 implements MigrationInterface {
  name = 'CreateDispenserSlots1760000004000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "dispenser_slots" (
        "slot_key"        varchar NOT NULL,
        "denomination_id" integer REFERENCES "denominations" ("id"),
        "label"           varchar NOT NULL,
        "is_active"       boolean NOT NULL DEFAULT 1,
        PRIMARY KEY ("slot_key")
      )
    `);

    await queryRunner.query(`
      INSERT OR IGNORE INTO "dispenser_slots" ("slot_key", "denomination_id", "label", "is_active") VALUES
      ('bill1', 10000, 'Dispensador billetes 1 — $10.000', 1),
      ('bill2',  2000, 'Dispensador billetes 2 — $2.000',  1),
      ('coin1',   500, 'Monedero bus 1 — $500',            1),
      ('coin2',   100, 'Monedero bus 2 — $100',            1)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "dispenser_slots"`);
  }
}
