/**
 * MovementAlertsScanCron — corre el análisis de movimientos sospechosos.
 * Default: `0 4 * * *` (4 AM UTC). Multi-tenant, env disable para tests.
 */

import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { eq } from 'drizzle-orm';
import { tenants, type ControlDb, type Tenant } from '@casino/db';
import { CONTROL_DB } from '../database/database.module';
import { TenantConnectionCache } from '../tenant-resolver/tenant-connection-cache';
import {
  MovementAlertsService,
  type MovementScanResult,
} from './movement-alerts.service';

const DEFAULT_CRON = '0 4 * * *';

@Injectable()
export class MovementAlertsScanCron {
  private readonly logger = new Logger(MovementAlertsScanCron.name);
  private running = false;
  private readonly enabled: boolean;

  constructor(
    private readonly config: ConfigService,
    @Inject(CONTROL_DB) private readonly controlDb: ControlDb,
    private readonly connectionCache: TenantConnectionCache,
    private readonly service: MovementAlertsService,
    private readonly scheduler: SchedulerRegistry,
  ) {
    this.enabled = config.get<string>('MOV_ALERTS_ENABLED') !== 'false';
    if (!this.enabled) {
      this.logger.warn('MovementAlertsScanCron DISABLED via MOV_ALERTS_ENABLED=false.');
      return;
    }
    this.registerCron();
  }

  private registerCron(): void {
    const cronExpr = this.config.get<string>('MOV_ALERTS_CRON') ?? DEFAULT_CRON;
    const job = new CronJob(cronExpr, () => {
      void this.runForAllTenants().catch((err) => {
        this.logger.error(`Cron tiró: ${(err as Error).message}`);
      });
    });
    this.scheduler.addCronJob('movement-alerts-scan', job);
    job.start();
    this.logger.log(`MovementAlertsScanCron registrado con schedule="${cronExpr}".`);
  }

  async runForAllTenants(): Promise<
    Array<{ tenantId: string; tenantSlug: string; result: MovementScanResult }>
  > {
    if (this.running) {
      this.logger.warn('runForAllTenants saltado: run previo activo.');
      return [];
    }
    this.running = true;
    const out: Array<{
      tenantId: string;
      tenantSlug: string;
      result: MovementScanResult;
    }> = [];
    try {
      const activeTenants: Tenant[] = await this.controlDb
        .select()
        .from(tenants)
        .where(eq(tenants.status, 'active'));
      for (const tenant of activeTenants) {
        try {
          const tenantDb = this.connectionCache.get(tenant);
          const result = await this.service.runScan(tenantDb);
          out.push({ tenantId: tenant.id, tenantSlug: tenant.slug, result });
        } catch (err) {
          this.logger.error(
            `Mov-alerts tenant ${tenant.slug}: ${(err as Error).message}`,
          );
        }
      }
    } finally {
      this.running = false;
    }
    return out;
  }
}
