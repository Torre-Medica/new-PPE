import { MigrationInterface, QueryRunner } from 'typeorm';

export class EnableFiftyAndHundredThousandDenomination1760000021000
  implements MigrationInterface
{
  name = 'EnableFiftyAndHundredThousandDenomination1760000021000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "denominations"
      SET "is_active" = 1
      WHERE "id" IN (50000, 100000)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "denominations"
      SET "is_active" = 0
      WHERE "id" IN (50000, 100000)
    `);
  }
}
