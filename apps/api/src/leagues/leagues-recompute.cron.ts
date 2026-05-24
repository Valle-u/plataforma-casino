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
 *   - Schedule customizable via `LEAGUES_RECOMPUTE_CRON`.
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
import { LeaguesService } from './leagues.service';

// Cron de recompute de standings.
//
// Sprint 53.1: bajado de cada 5 min → cada 1 min después del feedback
// de dueño "los puntos no suben en vivo". Trade-off: 5× más recomputes,
// pero a escala MVP (1-2 tenants, <5k participantes activos por liga)
// es trivial — cada recompute es 1 query agregada por liga + 1 UPSERT
// batch. Validado en Sprint 53.1 stress: 3.839 standings upserted en
// <100ms por liga.
//
// Override en producción: env LEAGUES_RECOMPUTE_CRON (cron expression
// estándar). Si la carga aumenta, subir el intervalo a 2 min con la
// expresión "*​/2 * * * *" (sin el cero-width — Drizzle no la necesita,
// es solo para escapar el comentario en TS).
const DEFAULT_CRON = '*/1 * * * *'; // cada 1 min

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
            msg.includes('does not exist') ||
            (err as { code?: string }).code === '3D000'
          ) {
            this.logger.warn(
              `Leagues recompute tenant ${tenant.slug}: DB inexistente (probable tenant huérfano).`,
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
  async runForTenant(
    db: import('../tenant-resolver/tenant-context').TenantDb,
  ): Promise<RecomputeResult[]> {
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
