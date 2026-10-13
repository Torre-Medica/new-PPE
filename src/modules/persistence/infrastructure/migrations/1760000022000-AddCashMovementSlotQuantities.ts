import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCashMovementSlotQuantities1760000022000 implements MigrationInterface {
  name = 'AddCashMovementSlotQuantities1760000022000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Cantidad de la tolva antes y despues de cada carga/descarga, para el historial
    // de cargas (anterior - nuevo - diferencia). Null en movimientos previos a esta
    // migracion y en los que no son de tolva.
    if (!(await queryRunner.hasColumn('cash_movements', 'quantity_before'))) {
      await queryRunner.query(`ALTER TABLE "cash_movements" ADD COLUMN "quantity_before" integer`);
    }
    if (!(await queryRunner.hasColumn('cash_movements', 'quantity_after'))) {
      await queryRunner.query(`ALTER TABLE "cash_movements" ADD COLUMN "quantity_after" integer`);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasColumn('cash_movements', 'quantity_after')) {
      await queryRunner.query(`ALTER TABLE "cash_movements" DROP COLUMN "quantity_after"`);
    }
    if (await queryRunner.hasColumn('cash_movements', 'quantity_before')) {
      await queryRunner.query(`ALTER TABLE "cash_movements" DROP COLUMN "quantity_before"`);
    }
  }
}
