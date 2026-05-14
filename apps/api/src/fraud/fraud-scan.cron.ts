/**
 * FraudScanCron — runner periódico del scan antifraude.
 *
 * Default schedule: `0 3 * * *` (3 AM UTC daily). El scan no es realtime
 * crítico — las cuentas duplicadas tardan días en operar, no minutos.
 *
 * Mismo pattern que los otros crons: programmatic registration, multi-
 * tenant iteration, env disable para tests.
 */

import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { eq } from 'drizzle-orm';
import { tenants, type ControlDb, type Tenant } from '@casino/db';
import { CONTROL_DB } from '../database/database.module';
import { TenantConnectionCache } from '../tenant-resolver/tenant-connection-cache';
import { FraudDetectionService, type ScanResult } from './fraud-detection.service';

const DEFAULT_CRON = '0 3 * * *'; // 3 AM UTC daily

@Injectable()
export class FraudScanCron {
  private readonly logger = new Logger(FraudScanCron.name);
  private running = false;
  private readonly enabled: boolean;

  constructor(
    private readonly config: ConfigService,
    @Inject(CONTROL_DB) private readonly controlDb: ControlDb,
    private readonly connectionCache: TenantConnectionCache,
    private readonly fraudService: FraudDetectionService,
    private readonly scheduler: SchedulerRegistry,
  ) {
    this.enabled = config.get<string>('FRAUD_SCAN_ENABLED') !== 'false';
    if (!this.enabled) {
      this.logger.warn('FraudScanCron DISABLED via FRAUD_SCAN_ENABLED=false.');
      return;
    }
    this.registerCron();
  }

  private registerCron(): void {
    const cronExpr = this.config.get<string>('FRAUD_SCAN_CRON') ?? DEFAULT_CRON;
    const job = new CronJob(cronExpr, () => {
      void this.runForAllTenants().catch((err) => {
        this.logger.error(`Cron tiró: ${(err as Error).message}`);
      });
    });
    this.scheduler.addCronJob('fraud-scan', job);
    job.start();
    this.logger.log(`FraudScanCron registrado con schedule="${cronExpr}".`);
  }

  async runForAllTenants(): Promise<
    Array<{ tenantId: string; tenantSlug: string; result: ScanResult }>
  > {
    if (this.running) {
      this.logger.warn('runForAllTenants saltado: run previo todavía activo.');
      return [];
    }
    this.running = true;
    const out: Array<{
      tenantId: string;
      tenantSlug: string;
      result: ScanResult;
    }> = [];
    try {
      const activeTenants: Tenant[] = await this.controlDb
        .select()
        .from(tenants)
        .where(eq(tenants.status, 'active'));

      this.logger.log(`Fraud scan: iterando ${activeTenants.length} tenants.`);

      for (const tenant of activeTenants) {
        try {
          const tenantDb = this.connectionCache.get(tenant);
          const result = await this.fraudService.runScan(tenantDb);
          out.push({ tenantId: tenant.id, tenantSlug: tenant.slug, result });
        } catch (err) {
          this.logger.error(
            `Fraud scan tenant ${tenant.slug}: ${(err as Error).message}`,
          );
        }
      }
    } finally {
      this.running = false;
    }
    return out;
  }
}
