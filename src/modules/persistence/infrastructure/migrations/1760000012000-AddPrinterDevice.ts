import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPrinterDevice1760000012000 implements MigrationInterface {
  name = 'AddPrinterDevice1760000012000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT OR IGNORE INTO devices (code, name, type, driver, port, status, last_error, last_heartbeat_at, created_at, updated_at)
      VALUES (
        'PRINTER',
        'Impresora termica',
        'PRINTER',
        'USB_LP',
        NULL,
        'DISCONNECTED',
        NULL,
        NULL,
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP
      )
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DELETE FROM devices WHERE code = 'PRINTER'`);
  }
}
