import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
} from 'node:fs';
import { basename, dirname, extname, join } from 'node:path';

@Injectable()
export class DatabaseBackupService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(DatabaseBackupService.name);
  private backupTimer: NodeJS.Timeout | null = null;
  private lastBackupDate: string | null = null;

  constructor(
    private readonly configService: ConfigService,
    private readonly dataSource: DataSource,
  ) {}

  onApplicationBootstrap(): void {
    void this.ensureDailyBackup();
    this.scheduleNextMidnightBackup();
  }

  onModuleDestroy(): void {
    if (this.backupTimer) {
      clearInterval(this.backupTimer);
      this.backupTimer = null;
    }
  }

  private async ensureDailyBackup(): Promise<void> {
    const today = this.toBackupDate(new Date());
    if (this.lastBackupDate === today) {
      return;
    }

    const databasePath = this.configService.getOrThrow<string>('database.path');
    if (!existsSync(databasePath)) {
      this.logger.warn(`Backup omitido: la base de datos no existe en ${databasePath}`);
      return;
    }

    const backupDir = join(dirname(databasePath), 'backup');
    mkdirSync(backupDir, { recursive: true });

    const sourceName = basename(databasePath, extname(databasePath));
    const extension = extname(databasePath) || '.sqlite';
    const backupPath = join(backupDir, `${sourceName}-${today}${extension}`);

    const currentBackup = this.findExistingBackupForDate(backupDir, today, extension);
    if (currentBackup) {
      this.lastBackupDate = today;
      this.deleteOtherBackups(backupDir, currentBackup);
      return;
    }

    try {
      await this.dataSource.query('PRAGMA wal_checkpoint(TRUNCATE)');
    } catch (error) {
      this.logger.warn(
        `No fue posible ejecutar WAL checkpoint antes del backup: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    copyFileSync(databasePath, backupPath);
    this.lastBackupDate = today;
    this.deleteOtherBackups(backupDir, backupPath);

    const sizeKb = Math.max(1, Math.round(statSync(backupPath).size / 1024));
    this.logger.log(`Backup diario creado en ${backupPath} (${sizeKb} KB)`);
  }

  private scheduleNextMidnightBackup(): void {
    if (this.backupTimer) {
      clearTimeout(this.backupTimer);
      this.backupTimer = null;
    }

    const now = new Date();
    const nextRun = new Date(now);
    nextRun.setHours(24, 0, 0, 0);

    const delayMs = Math.max(1_000, nextRun.getTime() - now.getTime());
    this.backupTimer = setTimeout(() => {
      void this.runScheduledBackup();
    }, delayMs);

    this.logger.log(`Siguiente backup diario programado para ${nextRun.toLocaleString('es-CO')}`);
  }

  private async runScheduledBackup(): Promise<void> {
    try {
      await this.ensureDailyBackup();
    } finally {
      this.scheduleNextMidnightBackup();
    }
  }

  private findExistingBackupForDate(
    backupDir: string,
    date: string,
    extension: string,
  ): string | null {
    const suffix = `-${date}${extension}`;
    const matches = readdirSync(backupDir)
      .filter((name) => name.endsWith(suffix))
      .map((name) => join(backupDir, name));

    return matches[0] ?? null;
  }

  private deleteOtherBackups(backupDir: string, keepPath: string): void {
    for (const fileName of readdirSync(backupDir)) {
      const fullPath = join(backupDir, fileName);
      if (fullPath === keepPath) {
        continue;
      }

      rmSync(fullPath, { force: true, recursive: true });
    }
  }

  private toBackupDate(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
}
