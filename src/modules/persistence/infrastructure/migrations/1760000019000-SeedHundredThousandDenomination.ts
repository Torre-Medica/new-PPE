import { MigrationInterface, QueryRunner } from 'typeorm';

export class SeedHundredThousandDenomination1760000019000
  implements MigrationInterface
{
  name = 'SeedHundredThousandDenomination1760000019000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // La denominacion 100000 nunca se sembro (el seed inicial solo llega hasta
    // 50000), pero el codigo de negocio SI la referencia (rechazo de billetes
    // grandes, registro de novedades) — sin esta fila, cualquier referencia a
    // ella viola la FK de denomination_id y revienta con foreign_keys=ON.
    await queryRunner.query(`
      INSERT OR IGNORE INTO "denominations" ("id", "kind", "currency", "is_active")
      VALUES (100000, 'BILL', 'COP', 0)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DELETE FROM "denominations" WHERE "id" = 100000`);
  }
}
