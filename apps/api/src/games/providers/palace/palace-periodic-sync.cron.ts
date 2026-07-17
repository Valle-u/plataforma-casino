/**
 * PalacePeriodicSyncCron — sincronización periódica del catálogo de Palace.
 *
 * Default schedule: `0 6 * * *` (6 AM UTC daily). Sincroniza juegos de
 * todos los tenants activos que tengan palace.api_token configurado.
 *
 * Pattern idéntico a FraudScanCron: programmatic registration, multi-tenant
 * iteration, env disable para tests.
 *
 * Env vars:
 *   - PALACE_SYNC_ENABLED: 'false' para deshabilitar (default: 'true')
 *   - PALACE_SYNC_CRON: expresión cron (default: '0 6 * * *')
 */

import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { eq } from 'drizzle-orm';
import { tenants, type ControlDb, type Tenant } from '@casino/db';
import { CONTROL_DB } from '../../../database/database.module';
import { TenantConnectionCache } from '../../../tenant-resolver/tenant-connection-cache';
import { PalaceSyncService, type PalaceSyncResult } from './palace-sync.service';
import { TenantSettingsService } from '../../../tenant-settings/tenant-settings.service';

const DEFAULT_CRON = '0 6 * * *'; // 6 AM UTC daily

@Injectable()
export class PalacePeriodicSyncCron {
  private readonly logger = new Logger(PalacePeriodicSyncCron.name);
  private running = false;
  private readonly enabled: boolean;

  constructor(
    private readonly config: ConfigService,
    @Inject(CONTROL_DB) private readonly controlDb: ControlDb,
    private readonly connectionCache: TenantConnectionCache,
    private readonly syncService: PalaceSyncService,
    private readonly settingsService: TenantSettingsService,
    private readonly scheduler: SchedulerRegistry,
  ) {
    this.enabled = config.get<string>('PALACE_SYNC_ENABLED') !== 'false';
    if (!this.enabled) {
      this.logger.warn('PalacePeriodicSyncCron DISABLED via PALACE_SYNC_ENABLED=false.');
      return;
    }
    this.registerCron();
  }

  private registerCron(): void {
    const cronExpr = this.config.get<string>('PALACE_SYNC_CRON') ?? DEFAULT_CRON;
    const job = new CronJob(cronExpr, () => {
      void this.runForAllTenants().catch((err) => {
        this.logger.error(`Palace sync cron tiró: ${(err as Error).message}`);
      });
    });
    this.scheduler.addCronJob('palace-periodic-sync', job);
    job.start();
    this.logger.log(`PalacePeriodicSyncCron registrado con schedule="${cronExpr}".`);
  }

  async runForAllTenants(): Promise<
    Array<{ tenantId: string; tenantSlug: string; result: PalaceSyncResult }>
  > {
    if (this.running) {
      this.logger.warn('runForAllTenants saltado: run previo todavía activo.');
      return [];
    }
    this.running = true;
    const out: Array<{
      tenantId: string;
      tenantSlug: string;
      result: PalaceSyncResult;
    }> = [];
    try {
      const activeTenants: Tenant[] = await this.controlDb
        .select()
        .from(tenants)
        .where(eq(tenants.status, 'active'));

      this.logger.log(`Palace periodic sync: iterando ${activeTenants.length} tenants.`);

      for (const tenant of activeTenants) {
        try {
          const db = this.connectionCache.get(tenant);
          const token = await this.settingsService.get<string>(db, 'palace.api_token');

          if (!token) {
            this.logger.debug(`Palace periodic sync: tenant ${tenant.slug} sin palace.api_token, skip`);
            continue;
          }

          const result = await this.syncService.syncGames(db);
          out.push({ tenantId: tenant.id, tenantSlug: tenant.slug, result });
          this.logger.log(
            `Palace periodic sync: ${tenant.slug} → ${result.fetched} juegos, ${result.created} nuevos, ${result.updated} actualizados, ${result.deactivated} desactivados`,
          );
        } catch (err) {
          this.logger.error(
            `Palace periodic sync: error en tenant ${tenant.slug}: ${(err as Error).message}`,
          );
        }
      }
    } finally {
      this.running = false;
    }
    return out;
  }
}
