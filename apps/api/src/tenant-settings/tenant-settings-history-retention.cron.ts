/**
 * TenantSettingsHistoryRetentionCron — purga periódica del history.
 *
 * Mismo patrón que los otros crons: programmatic registration, multi-
 * tenant iteration, env disable para tests. Default schedule
 * `0 4 * * *` (4 AM UTC, después del fraud scan en 3 AM para no
 * pisarse).
 *
 * Retention configurable por tenant via setting
 * `tenant_settings.history_retention_days` (default 365 días).
 *
 * Diseño:
 *   - DELETE simple por `changed_at < cutoff`. Sin batching para MVP —
 *     el history crece ~10 rows por setting actualizado por tenant; un
 *     tenant activo tiene unas miles de entries por año. Para tenants
 *     pequeños no necesitamos batch. Si crece volumen, agregar
 *     `LIMIT N` (postgres no soporta DELETE LIMIT directo; usar CTE).
 */

import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { eq } from 'drizzle-orm';
import { tenants, type ControlDb, type Tenant } from '@casino/db';
import { CONTROL_DB } from '../database/database.module';
import { TenantConnectionCache } from '../tenant-resolver/tenant-connection-cache';
import type { TenantDb } from '../tenant-resolver/tenant-context';
import { TenantSettingsService } from './tenant-settings.service';

const DEFAULT_CRON = '0 4 * * *'; // 4 AM UTC daily
const DEFAULT_RETENTION_DAYS = 365;

export interface RetentionRunResult {
  tenantId: string;
  tenantSlug: string;
  retentionDaysApplied: number;
  deleted: number;
}

@Injectable()
export class TenantSettingsHistoryRetentionCron {
  private readonly logger = new Logger(TenantSettingsHistoryRetentionCron.name);
  private running = false;
  private readonly enabled: boolean;

  constructor(
    private readonly config: ConfigService,
    @Inject(CONTROL_DB) private readonly controlDb: ControlDb,
    private readonly connectionCache: TenantConnectionCache,
    private readonly settingsService: TenantSettingsService,
    private readonly scheduler: SchedulerRegistry,
  ) {
    this.enabled =
      config.get<string>('TENANT_SETTINGS_HISTORY_RETENTION_ENABLED') !== 'false';
    if (!this.enabled) {
      this.logger.warn(
        'TenantSettingsHistoryRetentionCron DISABLED via env.',
      );
      return;
    }
    this.registerCron();
  }

  private registerCron(): void {
    const cronExpr =
      this.config.get<string>('TENANT_SETTINGS_HISTORY_RETENTION_CRON') ??
      DEFAULT_CRON;
    const job = new CronJob(cronExpr, () => {
      void this.runForAllTenants().catch((err) => {
        this.logger.error(`Cron tiró: ${(err as Error).message}`);
      });
    });
    this.scheduler.addCronJob('tenant-settings-history-retention', job);
    job.start();
    this.logger.log(
      `TenantSettingsHistoryRetentionCron registrado schedule="${cronExpr}".`,
    );
  }

  async runForAllTenants(): Promise<RetentionRunResult[]> {
    if (this.running) {
      this.logger.warn('runForAllTenants saltado: run previo todavía activo.');
      return [];
    }
    this.running = true;
    const out: RetentionRunResult[] = [];
    try {
      const activeTenants: Tenant[] = await this.controlDb
        .select()
        .from(tenants)
        .where(eq(tenants.status, 'active'));

      this.logger.log(
        `Settings history retention: iterando ${activeTenants.length} tenants.`,
      );

      for (const tenant of activeTenants) {
        try {
          const tenantDb = this.connectionCache.get(tenant);
          const result = await this.runForTenant(tenantDb);
          out.push({
            tenantId: tenant.id,
            tenantSlug: tenant.slug,
            ...result,
          });
        } catch (err) {
          this.logger.error(
            `Retention tenant ${tenant.slug}: ${(err as Error).message}`,
          );
        }
      }
    } finally {
      this.running = false;
    }
    return out;
  }

  /**
   * Procesa retention para un tenant específico. Llamado por el cron Y
   * por el endpoint admin para corrida manual.
   */
  async runForTenant(
    db: TenantDb,
  ): Promise<{ retentionDaysApplied: number; deleted: number }> {
    const retentionDays = await this.settingsService.getNumeric(
      db,
      'tenant_settings.history_retention_days',
      DEFAULT_RETENTION_DAYS,
    );
    const deleted = await this.settingsService.purgeOldHistory(db, retentionDays);
    if (deleted > 0) {
      this.logger.log(
        `Retention purge: ${deleted} entries borradas (retention=${retentionDays}d).`,
      );
    }
    return { retentionDaysApplied: retentionDays, deleted };
  }
}
