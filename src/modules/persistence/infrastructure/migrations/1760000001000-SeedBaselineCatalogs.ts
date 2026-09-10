import { MigrationInterface, QueryRunner } from 'typeorm';

export class SeedBaselineCatalogs1760000001000 implements MigrationInterface {
  name = 'SeedBaselineCatalogs1760000001000';

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

    // devices ya se insertan en InitialPpeSchema (migración 0000)
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // devices gestionados por InitialPpeSchema (migración 0000)
    await queryRunner.query(`
      DELETE FROM "cash_inventory"
      WHERE "denomination_id" IN (50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000)
    `);
    await queryRunner.query(`
      DELETE FROM "denominations"
      WHERE "id" IN (50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000)
    `);
  }
}
