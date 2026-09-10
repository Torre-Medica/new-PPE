import 'reflect-metadata';
import 'dotenv/config';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DataSource } from 'typeorm';
import { resolveDefaultDatabasePath } from '@common/config/database-path';
import { persistenceEntities } from '@modules/persistence/infrastructure/persistence.constants';

interface SqlitePragmaCapable {
  pragma(statement: string): unknown;
}

const databasePath = resolveDefaultDatabasePath();
mkdirSync(dirname(databasePath), { recursive: true });

export default new DataSource({
  type: 'better-sqlite3',
  database: databasePath,
  entities: persistenceEntities,
  migrations: ['src/modules/persistence/infrastructure/migrations/*{.ts,.js}'],
  synchronize: false,
  logging: false,
  prepareDatabase: (database: SqlitePragmaCapable) => {
    // Mismos pragmas que typeorm.config.ts (runtime de la app) — este DataSource
    // lo usan los comandos de migracion, que deben abrir el archivo con las
    // mismas garantias de durabilidad/concurrencia que la aplicacion.
    database.pragma('foreign_keys = ON');
    database.pragma('journal_mode = WAL');
    database.pragma('busy_timeout = 5000');
    database.pragma('synchronous = FULL');
  },
});
