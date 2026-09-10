import { MigrationInterface, QueryRunner } from 'typeorm';

export class DevicesFixDenominationFk1760000006000 implements MigrationInterface {
  name = 'DevicesFixDenominationFk1760000006000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`PRAGMA foreign_keys = OFF`);

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
        "id","code","name","type","driver","port","denomination_id","status","last_error","last_heartbeat_at","created_at","updated_at"
      FROM "devices"
    `);

    await queryRunner.query(`DROP TABLE "devices"`);
    await queryRunner.query(`ALTER TABLE "devices_new" RENAME TO "devices"`);

    await queryRunner.query(`PRAGMA foreign_keys = ON`);
    await queryRunner.query(`PRAGMA foreign_key_check`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`PRAGMA foreign_keys = OFF`);

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
        "id","code","name","type","driver","port","denomination_id","status","last_error","last_heartbeat_at","created_at","updated_at"
      FROM "devices"
    `);

    await queryRunner.query(`DROP TABLE "devices"`);
    await queryRunner.query(`ALTER TABLE "devices_new" RENAME TO "devices"`);

    await queryRunner.query(`PRAGMA foreign_keys = ON`);
  }
}
