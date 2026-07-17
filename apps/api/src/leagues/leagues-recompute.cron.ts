/**
 * LeaguesRecomputeCron — recálculo periódico de standings para leagues
 * activas (Sprint 51.8.1).
 *
 * Problema que resuelve: antes el admin tenía que hacer click "Recompute"
 * para ver standings actualizados — mientras los players bettean, el
 * ranking visible quedaba congelado. Ahora corre cada 5 min y refresca
 * todas las leagues con status='active' que tienen ventana abierta.
 *
 * Patrón idéntico a `LeaguesCloseCron`:
 *   - Registración via SchedulerRegistry (no @Cron decorator).
 *   - Itera tenants activos del control DB.
 *   - Per-tenant: `WHERE status='active' AND startsAt <= NOW() AND endsAt > NOW()`.
 *   - Flag `running` anti-reentrada.
 *   - Disable via `LEAGUES_RECOMPUTE_ENABLED=false`.
 *   - Schedule customizable via `LEAGUES_RECOMPUTE_CRON` (default 5 min;
 *     dev típicamente lo bajan a 1 min para demos live).
 *
 * Notas operativas:
 *   - `recompute` es idempotente y rápido (~10-50ms para 100 players).
 *   - Si una league ya venció, el `LeaguesCloseCron` la cierra — este
 *     cron NO la toca (filtro por endsAt > NOW()).
 *   - Si por algún motivo el recompute falla en una league, se loguea
 *     y sigue con la siguiente (fail-soft).
 */

import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { and, eq, gt, lte } from 'drizzle-orm';
import { leagues, tenants, type ControlDb, type Tenant } from '@casino/db';
import { CONTROL_DB } from '../database/database.module';
import { TenantConnectionCache } from '../tenant-resolver/tenant-connection-cache';
import type { TenantDb } from '../tenant-resolver/tenant-context';
import { LeaguesService } from './leagues.service';

// Cron de recompute de standings.
//
// Default: cada 5 min (prod-safe). Para demos en vivo donde el dueño
// quiere ver standings actualizarse al toque, override en .env.local con
// LEAGUES_RECOMPUTE_CRON='*/1 * * * *'.
//
// Historia: Sprint 53.1 lo bajó a 1 min después del feedback "los puntos
// no suben en vivo", pero en producción con N tenants ese intervalo es
// agresivo (N × ligas activas × queries agregadas, cada minuto). Sprint
// 54: volvió al default conservador, dev override explícito en envs.
//
// Trade-off de cada recompute: 1 query agregada por liga + 1 UPSERT
// batch. Validado en Sprint 53.1 stress: 3.839 standings upserted en
// <100ms por liga.
const DEFAULT_CRON = '*/5 * * * *'; // cada 5 min — override en dev via env

interface RecomputeResult {
  leagueId: string;
  leagueCode: string;
  participants: number;
}

@Injectable()
export class LeaguesRecomputeCron {
  private readonly logger = new Logger(LeaguesRecomputeCron.name);
  private running = false;
  private readonly enabled: boolean;

  constructor(
    private readonly config: ConfigService,
    @Inject(CONTROL_DB) private readonly controlDb: ControlDb,
    private readonly connectionCache: TenantConnectionCache,
    private readonly leaguesService: LeaguesService,
    private readonly scheduler: SchedulerRegistry,
  ) {
    this.enabled =
      config.get<string>('LEAGUES_RECOMPUTE_ENABLED') !== 'false';
    if (!this.enabled) {
      this.logger.warn(
        'LeaguesRecomputeCron DISABLED via LEAGUES_RECOMPUTE_ENABLED=false.',
      );
      return;
    }
    this.registerCron();
  }

  private registerCron(): void {
    const cronExpr =
      this.config.get<string>('LEAGUES_RECOMPUTE_CRON') ?? DEFAULT_CRON;
    const job = new CronJob(cronExpr, () => {
      void this.runForAllTenants().catch((err) => {
        this.logger.error(`Cron tiró: ${(err as Error).message}`);
      });
    });
    this.scheduler.addCronJob('leagues-recompute', job);
    job.start();
    this.logger.log(
      `LeaguesRecomputeCron registrado con schedule="${cronExpr}".`,
    );
  }

  async runForAllTenants(): Promise<
    Array<{ tenantId: string; tenantSlug: string; results: RecomputeResult[] }>
  > {
    if (this.running) {
      this.logger.warn('runForAllTenants saltado: run previo todavía activo.');
      return [];
    }
    this.running = true;
    const out: Array<{
      tenantId: string;
      tenantSlug: string;
      results: RecomputeResult[];
    }> = [];
    try {
      const activeTenants: Tenant[] = await this.controlDb
        .select()
        .from(tenants)
        .where(eq(tenants.status, 'active'));

      this.logger.log(
        `Leagues recompute: iterando ${activeTenants.length} tenants.`,
      );

      for (const tenant of activeTenants) {
        try {
          const tenantDb = this.connectionCache.get(tenant);
          const results = await this.runForTenant(tenantDb);
          out.push({
            tenantId: tenant.id,
            tenantSlug: tenant.slug,
            results,
          });
        } catch (err) {
          const msg = (err as Error).message;
          if (
            msg.includes('no existe la base de datos') ||
            msg.includes('database') && msg.includes('does not exist') ||
            (err as { code?: string }).code === '3D000'
          ) {
            this.logger.warn(
              `Leagues recompute tenant ${tenant.slug}: DB inexistente (probable tenant huérfano).`,
            );
          } else if (
            (err as { code?: string }).code === '42P01' ||
            msg.includes('does not exist')
          ) {
            this.logger.warn(
              `Leagues recompute tenant ${tenant.slug}: tabla leagues inexistente (skip).`,
            );
          } else {
            this.logger.error(
              `Leagues recompute tenant ${tenant.slug} (${tenant.id}): ${msg}`,
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
   * Recompute todas las leagues activas con ventana abierta del tenant.
   * Llamado por el cron y opcionalmente por un endpoint admin futuro.
   */
  async runForTenant(db: TenantDb): Promise<RecomputeResult[]> {
    const now = new Date();
    const active = await db
      .select({ id: leagues.id, code: leagues.code })
      .from(leagues)
      .where(
        and(
          eq(leagues.status, 'active'),
          lte(leagues.startsAt, now),
          gt(leagues.endsAt, now),
        ),
      )
      .limit(100); // batch limit defensivo

    const out: RecomputeResult[] = [];
    for (const row of active) {
      try {
        const standings = await this.leaguesService.recompute(db, row.id);
        out.push({
          leagueId: row.id,
          leagueCode: row.code,
          participants: standings.length,
        });
      } catch (err) {
        this.logger.error(
          `Recompute league ${row.code} (${row.id}): ${(err as Error).message}`,
        );
      }
    }
    if (out.length > 0) {
      this.logger.log(
        `Recomputed ${out.length} leagues activas (${out
          .map((r) => `${r.leagueCode}=${r.participants}`)
          .join(', ')}).`,
      );
    }
    return out;
  }
}
