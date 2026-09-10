import { MigrationInterface, QueryRunner } from 'typeorm';

export class DisableHundredThousandDenomination1760000002000
  implements MigrationInterface
{
  name = 'DisableHundredThousandDenomination1760000002000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "denominations"
      SET "is_active" = 0
      WHERE "id" = 100000
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "denominations"
      SET "is_active" = 1
      WHERE "id" = 100000
    `);
  }
}
