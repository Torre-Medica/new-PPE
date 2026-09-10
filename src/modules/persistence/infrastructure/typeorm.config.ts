import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModuleAsyncOptions } from '@nestjs/typeorm';
import { persistenceEntities } from '@modules/persistence/infrastructure/persistence.constants';

interface SqlitePragmaCapable {
  pragma(statement: string): unknown;
}

export const typeOrmAsyncConfig: TypeOrmModuleAsyncOptions = {
  inject: [ConfigService],
  useFactory: (configService: ConfigService) => {
    const databasePath = configService.getOrThrow<string>('database.path');
    mkdirSync(dirname(databasePath), { recursive: true });

    return {
      type: 'better-sqlite3',
      database: databasePath,
      entities: persistenceEntities,
      synchronize: false,
      logging: configService.get<boolean>('database.logging', false),
      prepareDatabase: (database: SqlitePragmaCapable) => {
        database.pragma('foreign_keys = ON');
        // WAL permite lecturas concurrentes mientras hay una escritura en curso
        database.pragma('journal_mode = WAL');
        // Si dos escrituras coinciden, esperar hasta 5s antes de fallar con SQLITE_BUSY
        database.pragma('busy_timeout = 5000');
        // FULL fuerza fsync en cada commit: en WAL mode el default es NORMAL, que
        // evita corrupcion pero puede perder el ultimo commit ante un corte de luz.
        // Es una maquina de pagos — se prioriza durabilidad sobre latencia minima.
        database.pragma('synchronous = FULL');
      },
    };
  },
};
