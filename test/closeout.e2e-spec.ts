import 'reflect-metadata';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DataSource, Repository } from 'typeorm';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { persistenceEntities } from '@modules/persistence/infrastructure/persistence.constants';
import { CashInventoryService } from '@modules/cash-management/application/cash-inventory.service';
import {
  CashMovementEntity,
} from '@modules/persistence/infrastructure/entities/cash-movement.entity';
import {
  PaymentSessionEntity,
  PaymentSessionStatus,
} from '@modules/persistence/infrastructure/entities/payment-session.entity';
import { CashInventoryEntity } from '@modules/persistence/infrastructure/entities/cash-inventory.entity';
import { DispenserSlotEntity } from '@modules/persistence/infrastructure/entities/dispenser-slot.entity';
import { AppModule } from '../src/app.module';

/**
 * Prueba de integracion REAL (SQLite en disco temporal + migraciones reales,
 * sin mocks) del flujo completo de cierres de caja. Verifica exactamente lo
 * que se pidio validar:
 *
 * 1. Un cierre TOTAL "cierra la maquina": resetea el efectivo RECOLECTADO
 *    (cash_inventory) a 0, pero NO toca los dispensadores de cambio
 *    (dispenser_slots) — esos son cargados por el operador, no dinero de clientes.
 * 2. Un segundo cierre TOTAL inmediatamente despues (sin transacciones nuevas)
 *    arranca exactamente donde termino el anterior (mismas fechas) y sale
 *    todo en 0 — no duplica ni repite el primer cierre.
 * 3. Transacciones, dinero recibido y dinero en tolvas del PRIMER cierre son
 *    exactos en numero y monto.
 */
describe('Cierres de caja (integracion real con SQLite)', () => {
  let app: INestApplication;
  let tempDir: string;
  let dbPath: string;

  beforeAll(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'ppe-closeout-test-'));
    dbPath = join(tempDir, 'test.sqlite');

    process.env.DATABASE_PATH = dbPath;
    process.env.PPE_HEADLESS_MODE = 'true';
    process.env.LOCAL_API_AUDIT_KEY = 'ppe-audit-local';
    process.env.LOCAL_API_OPERATOR_KEY = 'ppe-operator-local';
    process.env.LOCAL_API_ADMIN_KEY = 'ppe-admin-local';
    process.env.PORT = '0';

    // Corre las migraciones reales (mismas que produccion) contra el archivo
    // temporal ANTES de levantar el modulo de Nest (que abre con synchronize:false).
    const migrationDataSource = new DataSource({
      type: 'better-sqlite3',
      database: dbPath,
      entities: persistenceEntities,
      migrations: ['src/modules/persistence/infrastructure/migrations/*.ts'],
      synchronize: false,
      logging: false,
      prepareDatabase: (database: { pragma(statement: string): unknown }) => {
        database.pragma('foreign_keys = ON');
        database.pragma('journal_mode = WAL');
        database.pragma('synchronous = FULL');
      },
    });
    await migrationDataSource.initialize();
    await migrationDataSource.runMigrations();
    await migrationDataSource.destroy();

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  }, 30000);

  afterAll(async () => {
    if (app) {
      await app.close();
    }
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('primer cierre TOTAL: recolecta lo insertado, resetea inventario recolectado, NO toca dispensadores', async () => {
    const cashInventoryService = app.get(CashInventoryService);
    const sessionRepo: Repository<PaymentSessionEntity> = app.get(
      getRepositoryToken(PaymentSessionEntity),
    );
    const inventoryRepo: Repository<CashInventoryEntity> = app.get(
      getRepositoryToken(CashInventoryEntity),
    );
    const slotRepo: Repository<DispenserSlotEntity> = app.get(
      getRepositoryToken(DispenserSlotEntity),
    );

    // ── Cargar el dispensador de cambio (tolvas) — NO debe resetearse en el cierre ──
    await slotRepo.update({ slotKey: 'bill1' }, { quantity: 20 }); // $10.000 x 20 = $200.000
    await slotRepo.update({ slotKey: 'coin1' }, { quantity: 50 }); // $500 x 50 = $25.000
    const dispenserTotalAntes = 20 * 10000 + 50 * 500; // 225.000

    // ── Simular 2 pagos completados con efectivo aceptado real ──
    const session1 = await sessionRepo.save(
      sessionRepo.create({
        targetAmount: 8000,
        insertedAmount: 8000,
        changeAmount: 0,
        status: PaymentSessionStatus.Completed,
        startedAt: new Date(),
        completedAt: new Date(),
      }),
    );
    const session2 = await sessionRepo.save(
      sessionRepo.create({
        targetAmount: 5000,
        insertedAmount: 5000,
        changeAmount: 0,
        status: PaymentSessionStatus.CompletedWithWarning,
        startedAt: new Date(),
        completedAt: new Date(),
      }),
    );

    // dinero recibido: 1x$5.000 + 1x$2.000 + 1x$1.000 (session1 = 8000) y 1x$5.000 (session2)
    await cashInventoryService.recordAcceptedCash({
      denominationId: 5000,
      quantity: 1,
      paymentSessionId: session1.id,
      createdBy: 'test',
    });
    await cashInventoryService.recordAcceptedCash({
      denominationId: 2000,
      quantity: 1,
      paymentSessionId: session1.id,
      createdBy: 'test',
    });
    await cashInventoryService.recordAcceptedCash({
      denominationId: 1000,
      quantity: 1,
      paymentSessionId: session1.id,
      createdBy: 'test',
    });
    await cashInventoryService.recordAcceptedCash({
      denominationId: 5000,
      quantity: 1,
      paymentSessionId: session2.id,
      createdBy: 'test',
    });
    const dineroRecibidoEsperado = 5000 + 2000 + 1000 + 5000; // 13.000

    const closeout1 = await cashInventoryService.createCashCloseout({
      closeoutType: 'TOTAL',
      closedBy: 'tester',
    });

    // ── Transacciones y dinero recibido: exactos en numero y monto ──
    expect(closeout1.transactionCount).toBe(2);
    expect(closeout1.totalCollected).toBe(dineroRecibidoEsperado);

    // ── Dinero en tolvas del tiquete: exacto, y separado del recolectado ──
    const receipt1 = JSON.parse(closeout1.receiptJson!);
    const hopperSection = receipt1.sections.find((s: { title: string }) => s.title === 'Dinero en tolvas');
    expect(hopperSection.total).toBe(dispenserTotalAntes);
    const receivedSection = receipt1.sections.find((s: { title: string }) => s.title === 'Dinero recibido');
    expect(receivedSection.total).toBe(dineroRecibidoEsperado);

    // ── El inventario RECOLECTADO (cash_inventory) debe quedar en 0 para TODAS las denominaciones ──
    const inventoryAfter = await inventoryRepo.find();
    expect(inventoryAfter.length).toBeGreaterThan(0);
    for (const row of inventoryAfter) {
      expect(row.quantity).toBe(0);
    }

    // ── Los DISPENSADORES (tolvas de cambio) NO deben tocarse por el cierre ──
    const bill1After = await slotRepo.findOne({ where: { slotKey: 'bill1' } });
    const coin1After = await slotRepo.findOne({ where: { slotKey: 'coin1' } });
    expect(bill1After?.quantity).toBe(20);
    expect(coin1After?.quantity).toBe(50);

    // ── Un segundo cierre TOTAL inmediato, sin transacciones nuevas, debe salir en 0 ──
    const closeout2 = await cashInventoryService.createCashCloseout({
      closeoutType: 'TOTAL',
      closedBy: 'tester',
    });

    expect(closeout2.transactionCount).toBe(0);
    expect(closeout2.totalCollected).toBe(0);

    // Las fechas deben coincidir exactamente: el segundo cierre arranca donde
    // termino el primero — ningun hueco, ninguna superposicion.
    expect(new Date(closeout2.periodStartedAt).getTime()).toBe(
      new Date(closeout1.periodEndedAt).getTime(),
    );

    const receipt2 = JSON.parse(closeout2.receiptJson!);
    const receivedSection2 = receipt2.sections.find((s: { title: string }) => s.title === 'Dinero recibido');
    expect(receivedSection2.total).toBe(0);
    const dispensedSection2 = receipt2.sections.find((s: { title: string }) => s.title === 'Dinero devolucion');
    expect(dispensedSection2.total).toBe(0);

    // Los dispensadores siguen intactos tras el segundo cierre tambien —
    // los cierres NUNCA deben afectarlos, sin importar cuantos se hagan seguidos.
    const hopperSection2 = receipt2.sections.find((s: { title: string }) => s.title === 'Dinero en tolvas');
    expect(hopperSection2.total).toBe(dispenserTotalAntes);
    const bill1After2 = await slotRepo.findOne({ where: { slotKey: 'bill1' } });
    expect(bill1After2?.quantity).toBe(20);
  }, 30000);
});
