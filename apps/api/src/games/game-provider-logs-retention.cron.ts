/**
 * GameProviderLogsRetentionCron — purga diaria de logs de proveedores > 30d.
 *
 * Mismo patrón que TenantSettingsHistoryRetentionCron.
 *
 * Env vars:
 *   - GAME_PROVIDER_LOGS_RETENTION_ENABLED: 'false' para deshabilitar.
 *   - GAME_PROVIDER_LOGS_RETENTION_CRON: expresión cron (default 3 AM UTC).
 */

import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { eq } from 'drizzle-orm';
import { tenants, type ControlDb, type Tenant } from '@casino/db';
import { CONTROL_DB } from '../database/database.module';
import { TenantConnectionCache } from '../tenant-resolver/tenant-connection-cache';
import { GameProviderLogsService } from './game-provider-logs.service';
import { CronLockService } from '../cron-lock/cron-lock.service';

const DEFAULT_CRON = '0 3 * * *'; // 3 AM UTC daily
const RETENTION_DAYS = 30;

@Injectable()
export class GameProviderLogsRetentionCron {
  private readonly logger = new Logger(GameProviderLogsRetentionCron.name);
  private running = false;
  private readonly enabled: boolean;

  constructor(
    private readonly config: ConfigService,
    @Inject(CONTROL_DB) private readonly controlDb: ControlDb,
    private readonly connectionCache: TenantConnectionCache,
    private readonly logs: GameProviderLogsService,
    private readonly scheduler: SchedulerRegistry,
    private readonly cronLock: CronLockService,
  ) {
    this.enabled =
      config.get<string>('GAME_PROVIDER_LOGS_RETENTION_ENABLED') !== 'false';
    if (!this.enabled) {
      this.logger.warn('GameProviderLogsRetentionCron DISABLED via env.');
      return;
    }
    this.registerCron();
  }

  private registerCron(): void {
    const cronExpr =
      this.config.get<string>('GAME_PROVIDER_LOGS_RETENTION_CRON') ??
      DEFAULT_CRON;
    const job = new CronJob(cronExpr, () => {
      void this.cronLock
        .runExclusive('game-provider-logs-retention', () => this.runForAllTenants().then(() => undefined))
        .catch((err) => {
        this.logger.error(`Retention cron tiró: ${(err as Error).message}`);
      });
    });
    this.scheduler.addCronJob('game-provider-logs-retention', job);
    job.start();
    this.logger.log(
      `GameProviderLogsRetentionCron registrado schedule="${cronExpr}".`,
    );
  }

  async runForAllTenants(): Promise<void> {
    if (this.running) {
      this.logger.warn('Retention run saltado: run previo todavía activo.');
      return;
    }
    this.running = true;
    try {
      const activeTenants: Tenant[] = await this.controlDb
        .select()
        .from(tenants)
        .where(eq(tenants.status, 'active'));

      for (const tenant of activeTenants) {
        try {
          const tenantDb = this.connectionCache.get(tenant);
          const deleted = await this.logs.purgeOlderThan(
            tenantDb,
            RETENTION_DAYS,
          );
          if (deleted > 0) {
            this.logger.log(
              `Retention ${tenant.slug}: ${deleted} logs borrados (>${RETENTION_DAYS}d).`,
            );
          }
        } catch (err) {
          this.logger.error(
            `Retention tenant ${tenant.slug}: ${(err as Error).message}`,
          );
        }
      }
    } finally {
      this.running = false;
    }
  }
}
