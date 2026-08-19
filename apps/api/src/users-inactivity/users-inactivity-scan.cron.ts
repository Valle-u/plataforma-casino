/**
 * UsersInactivityScanCron — barrido diario de jugadores inactivos.
 *
 * Default schedule: `0 5 * * *` (5 AM UTC daily). No es realtime: marcar a un
 * jugador dormido puede esperar al barrido nocturno.
 *
 * Mismo pattern que los otros crons (fraud/movement-alerts): registro
 * programático, iteración multi-tenant, env para desactivar en tests.
 * Se puede apagar por tenant con el setting `users.inactivity_days = 0`.
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
  UsersInactivityService,
  type InactivityScanResult,
} from './users-inactivity.service';
import { CronLockService } from '../cron-lock/cron-lock.service';

const DEFAULT_CRON = '0 5 * * *'; // 5 AM UTC daily

@Injectable()
export class UsersInactivityScanCron {
  private readonly logger = new Logger(UsersInactivityScanCron.name);
  private running = false;
  private readonly enabled: boolean;

  constructor(
    private readonly config: ConfigService,
    @Inject(CONTROL_DB) private readonly controlDb: ControlDb,
    private readonly connectionCache: TenantConnectionCache,
    private readonly service: UsersInactivityService,
    private readonly scheduler: SchedulerRegistry,
    private readonly cronLock: CronLockService,
  ) {
    this.enabled = config.get<string>('USERS_INACTIVITY_ENABLED') !== 'false';
    if (!this.enabled) {
      this.logger.warn(
        'UsersInactivityScanCron DISABLED via USERS_INACTIVITY_ENABLED=false.',
      );
      return;
    }
    this.registerCron();
  }

  private registerCron(): void {
    const cronExpr =
      this.config.get<string>('USERS_INACTIVITY_CRON') ?? DEFAULT_CRON;
    const job = new CronJob(cronExpr, () => {
      void this.cronLock
        .runExclusive('users-inactivity-scan', () => this.runForAllTenants().then(() => undefined))
        .catch((err) => {
        this.logger.error(`Cron tiró: ${(err as Error).message}`);
      });
    });
    this.scheduler.addCronJob('users-inactivity-scan', job);
    job.start();
    this.logger.log(
      `UsersInactivityScanCron registrado con schedule="${cronExpr}".`,
    );
  }

  async runForAllTenants(): Promise<
    Array<{ tenantId: string; tenantSlug: string; result: InactivityScanResult }>
  > {
    if (this.running) {
      this.logger.warn('runForAllTenants saltado: run previo todavía activo.');
      return [];
    }
    this.running = true;
    const out: Array<{
      tenantId: string;
      tenantSlug: string;
      result: InactivityScanResult;
    }> = [];
    try {
      const activeTenants: Tenant[] = await this.controlDb
        .select()
        .from(tenants)
        .where(eq(tenants.status, 'active'));

      this.logger.log(
        `Inactivity scan: iterando ${activeTenants.length} tenants.`,
      );

      for (const tenant of activeTenants) {
        try {
          const tenantDb = this.connectionCache.get(tenant);
          const result = await this.service.runScan(tenantDb);
          out.push({ tenantId: tenant.id, tenantSlug: tenant.slug, result });
        } catch (err) {
          this.logger.error(
            `Inactivity scan tenant ${tenant.slug}: ${(err as Error).message}`,
          );
        }
      }
    } finally {
      this.running = false;
    }
    return out;
  }
}
