/**
 * LeaguesCloseCron — runner periódico para cerrar leagues vencidas.
 *
 * Mismo patrón que `BonusesExpirationCron` y `BonusesCashbackCron`.
 *   - Programmatic registration via `SchedulerRegistry`.
 *   - Itera tenants activos.
 *   - Por cada tenant, busca `leagues WHERE status='active' AND endsAt < NOW()`
 *     y llama `LeaguesService.closeAndSettle`.
 *   - Flag `running` anti-reentrada.
 *   - Disable via env.
 */

import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { and, eq, lt } from 'drizzle-orm';
import { leagues, tenants, type ControlDb, type Tenant } from '@casino/db';
import { CONTROL_DB } from '../database/database.module';
import { TenantConnectionCache } from '../tenant-resolver/tenant-connection-cache';
import type { TenantDb } from '../tenant-resolver/tenant-context';
import { LeaguesService, type CloseResult } from './leagues.service';

const DEFAULT_CRON = '*/15 * * * *'; // cada 15 min

@Injectable()
export class LeaguesCloseCron {
  private readonly logger = new Logger(LeaguesCloseCron.name);
  private running = false;
  private readonly enabled: boolean;

  constructor(
    private readonly config: ConfigService,
    @Inject(CONTROL_DB) private readonly controlDb: ControlDb,
    private readonly connectionCache: TenantConnectionCache,
    private readonly leaguesService: LeaguesService,
    private readonly scheduler: SchedulerRegistry,
  ) {
    this.enabled = config.get<string>('LEAGUES_CLOSE_ENABLED') !== 'false';
    if (!this.enabled) {
      this.logger.warn('LeaguesCloseCron DISABLED via LEAGUES_CLOSE_ENABLED=false.');
      return;
    }
    this.registerCron();
  }

  private registerCron(): void {
    const cronExpr = this.config.get<string>('LEAGUES_CLOSE_CRON') ?? DEFAULT_CRON;
    const job = new CronJob(cronExpr, () => {
      void this.runForAllTenants().catch((err) => {
        this.logger.error(`Cron tiró: ${(err as Error).message}`);
      });
    });
    this.scheduler.addCronJob('leagues-close', job);
    job.start();
    this.logger.log(`LeaguesCloseCron registrado con schedule="${cronExpr}".`);
  }

  async runForAllTenants(): Promise<
    Array<{ tenantId: string; tenantSlug: string; results: CloseResult[] }>
  > {
    if (this.running) {
      this.logger.warn('runForAllTenants saltado: run previo todavía activo.');
      return [];
    }
    this.running = true;
    const out: Array<{
      tenantId: string;
      tenantSlug: string;
      results: CloseResult[];
    }> = [];
    try {
      const activeTenants: Tenant[] = await this.controlDb
        .select()
        .from(tenants)
        .where(eq(tenants.status, 'active'));

      this.logger.log(`Leagues close: iterando ${activeTenants.length} tenants.`);

      for (const tenant of activeTenants) {
        try {
          const tenantDb = this.connectionCache.get(tenant);
          const results = await this.runForTenant(tenantDb);
          out.push({ tenantId: tenant.id, tenantSlug: tenant.slug, results });
        } catch (err) {
          // Sprint 44: ver comment idéntico en notifications-dispatcher.cron.ts.
          const msg = (err as Error).message;
          if (
            msg.includes('no existe la base de datos') ||
            msg.includes('database') && msg.includes('does not exist') ||
            (err as { code?: string }).code === '3D000'
          ) {
            this.logger.warn(
              `Leagues close tenant ${tenant.slug}: DB inexistente (probable tenant huérfano).`,
            );
          } else if (
            (err as { code?: string }).code === '42P01' ||
            msg.includes('does not exist')
          ) {
            this.logger.warn(
              `Leagues close tenant ${tenant.slug}: tabla leagues inexistente (skip).`,
            );
          } else {
            this.logger.error(
              `Leagues close tenant ${tenant.slug} (${tenant.id}): ${msg}`,
            );
          }
        }
      }
    } finally {
      this.running = false;
    }
    return out;
  }

  /**
   * Procesa todas las leagues vencidas en el tenant. Llamado por el cron
   * y por el endpoint admin `POST /tenant/leagues/jobs/close-due`.
   */
  async runForTenant(db: TenantDb): Promise<CloseResult[]> {
    const due = await db
      .select({ id: leagues.id, code: leagues.code })
      .from(leagues)
      .where(and(eq(leagues.status, 'active'), lt(leagues.endsAt, new Date())))
      .limit(100); // batch limit

    const out: CloseResult[] = [];
    for (const row of due) {
      try {
        const result = await this.leaguesService.closeAndSettle(db, row.id);
        out.push(result);
      } catch (err) {
        this.logger.error(
          `Close+settle league ${row.code} (${row.id}): ${(err as Error).message}`,
        );
      }
    }
    return out;
  }
}
