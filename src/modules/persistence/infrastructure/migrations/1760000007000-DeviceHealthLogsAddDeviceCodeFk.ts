import { MigrationInterface, QueryRunner } from 'typeorm';

export class DeviceHealthLogsAddDeviceCodeFk1760000007000 implements MigrationInterface {
  name = 'DeviceHealthLogsAddDeviceCodeFk1760000007000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`PRAGMA foreign_keys = OFF`);

    await queryRunner.query(`
      CREATE TABLE "device_health_logs_new" (
        "id"          integer PRIMARY KEY AUTOINCREMENT NOT NULL,
        "device_id"   integer NOT NULL,
        "device_code" varchar NOT NULL,
        "level"       varchar NOT NULL,
        "message"     varchar(500) NOT NULL,
        "created_at"  datetime NOT NULL DEFAULT (datetime('now')),
        CONSTRAINT "FK_device_health_logs_device_id"
          FOREIGN KEY ("device_id")
          REFERENCES "devices" ("id")
          ON DELETE CASCADE
          ON UPDATE CASCADE,
        CONSTRAINT "FK_device_health_logs_device_code"
          FOREIGN KEY ("device_code")
          REFERENCES "devices" ("code")
          ON DELETE CASCADE
          ON UPDATE CASCADE
      )
    `);

    await queryRunner.query(`
      INSERT INTO "device_health_logs_new" ("id","device_id","device_code","level","message","created_at")
      SELECT
        h."id",
        (SELECT d."id" FROM "devices" d WHERE d."code" = h."device_code"),
        h."device_code",
        h."level",
        h."message",
        h."created_at"
      FROM "device_health_logs" h
    `);

    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_device_health_logs_device_code"`);
    await queryRunner.query(`DROP TABLE "device_health_logs"`);
    await queryRunner.query(`ALTER TABLE "device_health_logs_new" RENAME TO "device_health_logs"`);

    await queryRunner.query(`CREATE INDEX "IDX_device_health_logs_device_code" ON "device_health_logs" ("device_code")`);

    await queryRunner.query(`PRAGMA foreign_keys = ON`);
    await queryRunner.query(`PRAGMA foreign_key_check`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`PRAGMA foreign_keys = OFF`);

    await queryRunner.query(`
      CREATE TABLE "device_health_logs_new" (
        "id"          integer PRIMARY KEY AUTOINCREMENT NOT NULL,
        "device_code" varchar NOT NULL,
        "level"       varchar NOT NULL,
        "message"     varchar(500) NOT NULL,
        "created_at"  datetime NOT NULL DEFAULT (datetime('now'))
      )
    `);

    await queryRunner.query(`
      INSERT INTO "device_health_logs_new" ("id","device_code","level","message","created_at")
      SELECT "id","device_code","level","message","created_at"
      FROM "device_health_logs"
    `);

    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_device_health_logs_device_code"`);
    await queryRunner.query(`DROP TABLE "device_health_logs"`);
    await queryRunner.query(`ALTER TABLE "device_health_logs_new" RENAME TO "device_health_logs"`);

    await queryRunner.query(`CREATE INDEX "IDX_device_health_logs_device_code" ON "device_health_logs" ("device_code")`);

    await queryRunner.query(`PRAGMA foreign_keys = ON`);
  }
}
