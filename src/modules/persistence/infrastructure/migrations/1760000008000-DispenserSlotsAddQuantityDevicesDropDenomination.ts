import { MigrationInterface, QueryRunner } from 'typeorm';

export class DispenserSlotsAddQuantityDevicesDropDenomination1760000008000
  implements MigrationInterface
{
  name = 'DispenserSlotsAddQuantityDevicesDropDenomination1760000008000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. dispenser_slots: agregar columna quantity (SQLite soporta ADD COLUMN con DEFAULT)
    await queryRunner.query(`
      ALTER TABLE "dispenser_slots" ADD COLUMN "quantity" integer NOT NULL DEFAULT 0
    `);

    // 2. devices: recrear tabla sin denomination_id
    await queryRunner.query(`PRAGMA foreign_keys = OFF`);

    await queryRunner.query(`
      CREATE TABLE "devices_new" (
        "id"                  integer PRIMARY KEY AUTOINCREMENT NOT NULL,
        "code"                varchar NOT NULL UNIQUE,
        "name"                varchar NOT NULL,
        "type"                varchar NOT NULL,
        "driver"              varchar NOT NULL,
        "port"                varchar,
        "status"              varchar NOT NULL DEFAULT ('DISCONNECTED'),
        "last_error"          varchar,
        "last_heartbeat_at"   datetime,
        "created_at"          datetime NOT NULL DEFAULT (datetime('now')),
        "updated_at"          datetime NOT NULL DEFAULT (datetime('now'))
      )
    `);

    await queryRunner.query(`
      INSERT INTO "devices_new"
        ("id","code","name","type","driver","port","status","last_error","last_heartbeat_at","created_at","updated_at")
      SELECT
        "id","code","name","type","driver","port","status","last_error","last_heartbeat_at","created_at","updated_at"
      FROM "devices"
    `);

    await queryRunner.query(`DROP TABLE "devices"`);
    await queryRunner.query(`ALTER TABLE "devices_new" RENAME TO "devices"`);

    await queryRunner.query(`PRAGMA foreign_keys = ON`);
    await queryRunner.query(`PRAGMA foreign_key_check`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // 1. dispenser_slots: SQLite no soporta DROP COLUMN — recrear sin quantity
    await queryRunner.query(`PRAGMA foreign_keys = OFF`);

    await queryRunner.query(`
      CREATE TABLE "dispenser_slots_new" (
        "slot_key"        varchar NOT NULL,
        "denomination_id" integer REFERENCES "denominations" ("id"),
        "label"           varchar NOT NULL,
        "is_active"       boolean NOT NULL DEFAULT 1,
        PRIMARY KEY ("slot_key")
      )
    `);

    await queryRunner.query(`
      INSERT INTO "dispenser_slots_new" ("slot_key","denomination_id","label","is_active")
      SELECT "slot_key","denomination_id","label","is_active"
      FROM "dispenser_slots"
    `);

    await queryRunner.query(`DROP TABLE "dispenser_slots"`);
    await queryRunner.query(`ALTER TABLE "dispenser_slots_new" RENAME TO "dispenser_slots"`);

    // 2. devices: recrear con denomination_id de vuelta
    await queryRunner.query(`
      CREATE TABLE "devices_new" (
        "id"                  integer PRIMARY KEY AUTOINCREMENT NOT NULL,
        "code"                varchar NOT NULL UNIQUE,
        "name"                varchar NOT NULL,
        "type"                varchar NOT NULL,
        "driver"              varchar NOT NULL,
        "port"                varchar,
        "denomination_id"     integer,
        "status"              varchar NOT NULL DEFAULT ('DISCONNECTED'),
        "last_error"          varchar,
        "last_heartbeat_at"   datetime,
        "created_at"          datetime NOT NULL DEFAULT (datetime('now')),
        "updated_at"          datetime NOT NULL DEFAULT (datetime('now')),
        CONSTRAINT "FK_devices_denomination"
          FOREIGN KEY ("denomination_id")
          REFERENCES "denominations" ("id")
          ON DELETE SET NULL
          ON UPDATE RESTRICT
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

    await queryRunner.query(`PRAGMA foreign_keys = ON`);
  }
}
