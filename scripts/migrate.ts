/**
 * Custom migration runner — tracks applied migrations in data/migrations/applied.json
 * instead of a DB table, keeping the main SQLite file clean.
 *
 * Usage:
 *   npm run migration:run      → apply all pending
 *   npm run migration:revert   → revert last applied
 *   npm run migration:status   → show applied / pending
 */
import 'reflect-metadata';
import 'dotenv/config';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import type { MigrationInterface } from 'typeorm';
import dataSource from '../src/modules/persistence/infrastructure/data-source';

const TRACKING_FILE = join(process.cwd(), 'data', 'migrations', 'applied.json');

interface AppliedEntry {
  name: string;
  appliedAt: string;
}

function readApplied(): AppliedEntry[] {
  if (!existsSync(TRACKING_FILE)) return [];
  return JSON.parse(readFileSync(TRACKING_FILE, 'utf-8')) as AppliedEntry[];
}

function saveApplied(entries: AppliedEntry[]): void {
  mkdirSync(dirname(TRACKING_FILE), { recursive: true });
  writeFileSync(TRACKING_FILE, JSON.stringify(entries, null, 2) + '\n');
}

function extractTimestamp(name: string): number {
  return Number(name.match(/(\d+)$/)?.[1] ?? 0);
}

async function main(): Promise<void> {
  const command = process.argv[2] ?? 'run';
  if (!['run', 'revert', 'status'].includes(command)) {
    console.error(`Comando desconocido: "${command}". Usar: run | revert | status`);
    process.exit(1);
  }

  await dataSource.initialize();

  const allMigrations = [...(dataSource.migrations as MigrationInterface[])].sort(
    (a, b) => extractTimestamp(a.name ?? '') - extractTimestamp(b.name ?? ''),
  );

  const applied = readApplied();
  const appliedNames = new Set(applied.map(e => e.name));
  const pending = allMigrations.filter(m => !appliedNames.has(m.name ?? ''));

  // ── STATUS ────────────────────────────────────────────────────────────────
  if (command === 'status') {
    console.log('\nEstado de migraciones:\n');
    allMigrations.forEach(m => {
      const tag = appliedNames.has(m.name ?? '') ? '✓ aplicada' : '○ pendiente';
      console.log(`  ${tag}  ${m.name}`);
    });
    console.log();
    await dataSource.destroy();
    return;
  }

  // ── RUN ───────────────────────────────────────────────────────────────────
  if (command === 'run') {
    if (pending.length === 0) {
      console.log('No hay migraciones pendientes.');
      await dataSource.destroy();
      return;
    }

    console.log(`\n${pending.length} migración(es) por aplicar:\n`);

    for (const migration of pending) {
      const name = migration.name ?? '(sin nombre)';
      const queryRunner = dataSource.createQueryRunner();
      try {
        await queryRunner.startTransaction();
        await migration.up(queryRunner);
        await queryRunner.commitTransaction();
        applied.push({ name, appliedAt: new Date().toISOString() });
        saveApplied(applied);
        console.log(`  ✓ ${name}`);
      } catch (err) {
        await queryRunner.rollbackTransaction();
        console.error(`  ✗ ${name} — error:`, err);
        await queryRunner.release();
        await dataSource.destroy();
        process.exit(1);
      }
      await queryRunner.release();
    }

    console.log('\nTodas las migraciones aplicadas.\n');
  }

  // ── REVERT ────────────────────────────────────────────────────────────────
  if (command === 'revert') {
    if (applied.length === 0) {
      console.log('No hay migraciones aplicadas para revertir.');
      await dataSource.destroy();
      return;
    }

    const last = applied[applied.length - 1];
    const migration = allMigrations.find(m => m.name === last.name);

    if (!migration) {
      console.error(`No se encontró la clase de migración: ${last.name}`);
      await dataSource.destroy();
      process.exit(1);
    }

    const queryRunner = dataSource.createQueryRunner();
    try {
      await queryRunner.startTransaction();
      await migration.down(queryRunner);
      await queryRunner.commitTransaction();
      applied.pop();
      saveApplied(applied);
      console.log(`\n  ↩ Revertida: ${migration.name}\n`);
    } catch (err) {
      await queryRunner.rollbackTransaction();
      console.error(`  ✗ Fallo al revertir:`, err);
    }
    await queryRunner.release();
  }

  await dataSource.destroy();
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
