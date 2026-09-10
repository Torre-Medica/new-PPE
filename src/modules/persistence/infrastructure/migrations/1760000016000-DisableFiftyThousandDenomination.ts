import { MigrationInterface, QueryRunner } from 'typeorm';

export class DisableFiftyThousandDenomination1760000016000
  implements MigrationInterface
{
  name = 'DisableFiftyThousandDenomination1760000016000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "denominations"
      SET "is_active" = 0
      WHERE "id" = 50000
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "denominations"
      SET "is_active" = 1
      WHERE "id" = 50000
    `);
  }
}
