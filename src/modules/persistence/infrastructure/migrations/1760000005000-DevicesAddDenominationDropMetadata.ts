import { MigrationInterface, QueryRunner } from 'typeorm';

export class DevicesAddDenominationDropMetadata1760000005000 implements MigrationInterface {
  name = 'DevicesAddDenominationDropMetadata1760000005000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // SQLite no soporta DROP COLUMN + ADD COLUMN en la misma transacción
    // por eso recreamos la tabla devices sin metadata_json y con denomination_id
    await queryRunner.query(`
      CREATE TABLE "devices_new" (
        "id"                  integer PRIMARY KEY AUTOINCREMENT NOT NULL,
        "code"                varchar NOT NULL UNIQUE,
        "name"                varchar NOT NULL,
        "type"                varchar NOT NULL,
        "driver"              varchar NOT NULL,
        "port"                varchar,
        "denomination_id"     integer REFERENCES "denominations" ("id"),
        "status"              varchar NOT NULL DEFAULT ('DISCONNECTED'),
        "last_error"          varchar,
        "last_heartbeat_at"   datetime,
        "created_at"          datetime NOT NULL DEFAULT (datetime('now')),
        "updated_at"          datetime NOT NULL DEFAULT (datetime('now'))
      )
    `);

    await queryRunner.query(`
      INSERT INTO "devices_new"
        ("id","code","name","type","driver","port","denomination_id","status","last_error","last_heartbeat_at","created_at","updated_at")
      SELECT
        "id","code","name","type","driver","port", NULL,"status","last_error","last_heartbeat_at","created_at","updated_at"
      FROM "devices"
    `);

    await queryRunner.query(`DROP TABLE "devices"`);
    await queryRunner.query(`ALTER TABLE "devices_new" RENAME TO "devices"`);

    // 4 nuevos dispositivos físicos: billeteros y monederos por slot
    await queryRunner.query(`
      INSERT OR IGNORE INTO "devices"
        ("code","name","type","driver","denomination_id","port","status","last_error","last_heartbeat_at")
      VALUES
        ('DISPENSER_BILL_1','Billetero 1','DISPENSER_BILL_1','ELECTRONIC_BOARD',10000,NULL,'DISCONNECTED',NULL,NULL),
        ('DISPENSER_BILL_2','Billetero 2','DISPENSER_BILL_2','ELECTRONIC_BOARD', 2000,NULL,'DISCONNECTED',NULL,NULL),
        ('DISPENSER_COIN_1','Monedero 1','DISPENSER_COIN_1','ELECTRONIC_BOARD',  500,NULL,'DISCONNECTED',NULL,NULL),
        ('DISPENSER_COIN_2','Monedero 2','DISPENSER_COIN_2','ELECTRONIC_BOARD',  100,NULL,'DISCONNECTED',NULL,NULL)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DELETE FROM "devices" WHERE "code" IN ('DISPENSER_BILL_1','DISPENSER_BILL_2','DISPENSER_COIN_1','DISPENSER_COIN_2')`);

    await queryRunner.query(`
      CREATE TABLE "devices_old" (
        "id"                integer PRIMARY KEY AUTOINCREMENT NOT NULL,
        "code"              varchar NOT NULL UNIQUE,
        "name"              varchar NOT NULL,
        "type"              varchar NOT NULL,
        "driver"            varchar NOT NULL,
        "port"              varchar,
        "status"            varchar NOT NULL DEFAULT ('DISCONNECTED'),
        "metadata_json"     text,
        "last_error"        varchar,
        "last_heartbeat_at" datetime,
        "created_at"        datetime NOT NULL DEFAULT (datetime('now')),
        "updated_at"        datetime NOT NULL DEFAULT (datetime('now'))
      )
    `);

    await queryRunner.query(`
      INSERT INTO "devices_old"
        ("id","code","name","type","driver","port","status","metadata_json","last_error","last_heartbeat_at","created_at","updated_at")
      SELECT
        "id","code","name","type","driver","port","status",NULL,"last_error","last_heartbeat_at","created_at","updated_at"
      FROM "devices"
    `);

    await queryRunner.query(`DROP TABLE "devices"`);
    await queryRunner.query(`ALTER TABLE "devices_old" RENAME TO "devices"`);
  }
}
