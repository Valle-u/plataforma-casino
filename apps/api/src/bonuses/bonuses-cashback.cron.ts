/**
 * BonusesCashbackCron — runner periódico para `BonusesCashbackService`.
 *
 * Mismo patrón que `BonusesExpirationCron`:
 *   - Programmatic registration via `SchedulerRegistry` (permite env-config
 *     del schedule).
 *   - Itera tenants activos, llama service por cada uno.
 *   - Try/catch por tenant.
 *   - Flag `running` anti-reentrada.
 *   - Disable via env.
 *
 * Configuración:
 *   - `BONUSES_CASHBACK_CRON` env (default `0 1 * * *` = 1AM UTC daily).
 *   - `BONUSES_CASHBACK_ENABLED='false'` deshabilita.
 *
 * Schedule diario aunque los buckets sean semanales: el service decide
 * qué bucket procesar según `periodDays`. Días donde el bucket cerrado
 * más reciente ya fue procesado son no-op idempotente.
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
  BonusesCashbackService,
  type CashbackRunResult,
} from './bonuses-cashback.service';

const DEFAULT_CRON = '0 1 * * *'; // 1AM UTC daily

@Injectable()
export class BonusesCashbackCron {
  private readonly logger = new Logger(BonusesCashbackCron.name);
  private running = false;
  private readonly enabled: boolean;

  constructor(
    private readonly config: ConfigService,
    @Inject(CONTROL_DB) private readonly controlDb: ControlDb,
    private readonly connectionCache: TenantConnectionCache,
    private readonly cashbackService: BonusesCashbackService,
    private readonly scheduler: SchedulerRegistry,
  ) {
    this.enabled = config.get<string>('BONUSES_CASHBACK_ENABLED') !== 'false';
    if (!this.enabled) {
      this.logger.warn(
        'BonusesCashbackCron DISABLED via BONUSES_CASHBACK_ENABLED=false.',
      );
      return;
    }
    this.registerCron();
  }

  private registerCron(): void {
    const cronExpr = this.config.get<string>('BONUSES_CASHBACK_CRON') ?? DEFAULT_CRON;
    const job = new CronJob(cronExpr, () => {
      void this.runForAllTenants().catch((err) => {
        this.logger.error(
          `Cron runForAllTenants tiró: ${(err as Error).message}`,
        );
      });
    });
    this.scheduler.addCronJob('bonuses-cashback', job);
    job.start();
    this.logger.log(`BonusesCashbackCron registrado con schedule="${cronExpr}".`);
  }

  async runForAllTenants(): Promise<
    Array<{ tenantId: string; tenantSlug: string; result: CashbackRunResult }>
  > {
    if (this.running) {
      this.logger.warn('runForAllTenants saltado: run previo todavía activo.');
      return [];
    }
    this.running = true;
    const results: Array<{
      tenantId: string;
      tenantSlug: string;
      result: CashbackRunResult;
    }> = [];
    try {
      const activeTenants: Tenant[] = await this.controlDb
        .select()
        .from(tenants)
        .where(eq(tenants.status, 'active'));

      this.logger.log(
        `Bonuses cashback: iterando ${activeTenants.length} tenants activos.`,
      );

      for (const tenant of activeTenants) {
        try {
          const tenantDb = this.connectionCache.get(tenant);
          const result = await this.cashbackService.runForTenant(tenantDb);
          results.push({ tenantId: tenant.id, tenantSlug: tenant.slug, result });
        } catch (err) {
          this.logger.error(
            `Cashback tenant ${tenant.slug} (${tenant.id}) falló: ${(err as Error).message}`,
          );
        }
      }
    } finally {
      this.running = false;
    }
    return results;
  }
}
