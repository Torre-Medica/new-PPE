import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCashMovementSlotKeyAndCloseoutHopperTotal1760000020000
  implements MigrationInterface
{
  name = 'AddCashMovementSlotKeyAndCloseoutHopperTotal1760000020000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const hasSlotKey = await queryRunner.hasColumn('cash_movements', 'slot_key');
    if (!hasSlotKey) {
      // Distingue las recargas/descargas de una tolva de dispensado (dispenser_slots)
      // de los movimientos LOAD/UNLOAD genericos de la caja recolectora (cash_inventory).
      // Antes ambos quedaban como type='LOAD' sin forma confiable de separarlos, mas
      // alla del texto libre de "reason".
      await queryRunner.query(`
        ALTER TABLE "cash_movements" ADD COLUMN "slot_key" varchar(16)
      `);
    }

    const hasHopperTotal = await queryRunner.hasColumn('cash_closeouts', 'hopper_total');
    if (!hasHopperTotal) {
      // Snapshot del total en tolvas al momento del cierre, para que el siguiente
      // cierre pueda mostrar "tolvas inicial" sin tener que parsear receipt_json.
      await queryRunner.query(`
        ALTER TABLE "cash_closeouts" ADD COLUMN "hopper_total" integer NOT NULL DEFAULT 0
      `);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const hasSlotKey = await queryRunner.hasColumn('cash_movements', 'slot_key');
    if (hasSlotKey) {
      await queryRunner.query(`PRAGMA foreign_keys = OFF`);

      await queryRunner.query(`
        CREATE TABLE "cash_movements_new" (
          "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
          "type" varchar NOT NULL,
          "denomination_id" integer NOT NULL,
          "quantity" integer NOT NULL,
          "unit_value" integer NOT NULL,
          "total_value" integer NOT NULL,
          "reason" varchar(255) NOT NULL,
          "payment_session_id" varchar(36),
          "created_by" varchar(120) NOT NULL,
          "created_at" datetime NOT NULL DEFAULT (datetime('now')),
          CONSTRAINT "FK_cash_movements_denomination"
            FOREIGN KEY ("denomination_id")
            REFERENCES "denominations" ("id")
            ON DELETE RESTRICT
            ON UPDATE RESTRICT,
          CONSTRAINT "FK_cash_movements_session"
            FOREIGN KEY ("payment_session_id")
            REFERENCES "payment_sessions" ("id")
            ON DELETE SET NULL
            ON UPDATE CASCADE
        )
      `);

      await queryRunner.query(`
        INSERT INTO "cash_movements_new"
          ("id","type","denomination_id","quantity","unit_value","total_value","reason","payment_session_id","created_by","created_at")
        SELECT
          "id","type","denomination_id","quantity","unit_value","total_value","reason","payment_session_id","created_by","created_at"
        FROM "cash_movements"
      `);

      await queryRunner.query(`DROP TABLE "cash_movements"`);
      await queryRunner.query(`ALTER TABLE "cash_movements_new" RENAME TO "cash_movements"`);
      await queryRunner.query(`CREATE INDEX "IDX_cash_movements_created_at" ON "cash_movements" ("created_at")`);
      await queryRunner.query(`CREATE INDEX "IDX_cash_movements_denomination_id" ON "cash_movements" ("denomination_id")`);
      await queryRunner.query(`CREATE INDEX "IDX_cash_movements_session_id" ON "cash_movements" ("payment_session_id")`);
      await queryRunner.query(`PRAGMA foreign_keys = ON`);
    }

    const hasHopperTotal = await queryRunner.hasColumn('cash_closeouts', 'hopper_total');
    if (hasHopperTotal) {
      await queryRunner.query(`PRAGMA foreign_keys = OFF`);

      await queryRunner.query(`
        CREATE TABLE "cash_closeouts_new" (
          "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
          "period_started_at" datetime NOT NULL,
          "period_ended_at" datetime NOT NULL,
          "closed_at" datetime NOT NULL,
          "closed_by" varchar(120) NOT NULL,
          "closeout_type" varchar(20) NOT NULL DEFAULT 'TOTAL',
          "transaction_count" integer NOT NULL DEFAULT 0,
          "total_collected" integer NOT NULL DEFAULT 0,
          "notes" varchar(255),
          "receipt_json" text,
          "created_at" datetime NOT NULL DEFAULT (datetime('now'))
        )
      `);

      await queryRunner.query(`
        INSERT INTO "cash_closeouts_new"
          ("id","period_started_at","period_ended_at","closed_at","closed_by","closeout_type","transaction_count","total_collected","notes","receipt_json","created_at")
        SELECT
          "id","period_started_at","period_ended_at","closed_at","closed_by","closeout_type","transaction_count","total_collected","notes","receipt_json","created_at"
        FROM "cash_closeouts"
      `);

      await queryRunner.query(`DROP TABLE "cash_closeouts"`);
      await queryRunner.query(`ALTER TABLE "cash_closeouts_new" RENAME TO "cash_closeouts"`);
      await queryRunner.query(`CREATE INDEX "IDX_cash_closeouts_closed_at" ON "cash_closeouts" ("closed_at")`);
      await queryRunner.query(`PRAGMA foreign_keys = ON`);
    }
  }
}
