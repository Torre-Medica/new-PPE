import { MigrationInterface, QueryRunner } from 'typeorm';

export class RenameDispenserSlotLabels1760000017000 implements MigrationInterface {
  name = 'RenameDispenserSlotLabels1760000017000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "dispenser_slots" SET "label" = CASE "slot_key"
        WHEN 'bill1' THEN 'Bill 1'
        WHEN 'bill2' THEN 'Bill 2'
        WHEN 'coin1' THEN 'Mon 1'
        WHEN 'coin2' THEN 'Mon 2'
        ELSE "label"
      END
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "dispenser_slots" SET "label" = CASE "slot_key"
        WHEN 'bill1' THEN 'Dispensador billetes 1 — $10.000'
        WHEN 'bill2' THEN 'Dispensador billetes 2 — $2.000'
        WHEN 'coin1' THEN 'Monedero bus 1 — $500'
        WHEN 'coin2' THEN 'Monedero bus 2 — $100'
        ELSE "label"
      END
    `);
  }
}
