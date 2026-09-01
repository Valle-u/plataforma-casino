/**
 * RoundsReconciliationCron — corre el cierre de rondas huérfanas en todos los
 * tenants activos.
 *
 * El "por qué" está en `RoundsReconciliationService`: Gregmorn deja rondas
 * abiertas para siempre y su API no permite consultarlas, así que hay que
 * cerrarlas por nuestra cuenta o la base de comisión queda corta.
 *
 * Configuración:
 *   - `ROUNDS_RECON_CRON` — expresión cron. Default: cada 10
 *     minutos. Frecuente a propósito: no es un job pesado (toca sólo las
 *     rondas abiertas, que son pocas y tienen índice parcial) y cuanto antes
 *     cierre, menos tiempo pasa la contabilidad desactualizada.
 *   - `ROUNDS_RECON_ENABLED=false` — lo apaga (tests, debug).
 *   - `ROUNDS_RECON_IDLE_HOURS` — inactividad para dar una sesión por muerta.
 *     Default 2.
 *   - `ROUNDS_RECON_STALE_HOURS` — último recurso: cerrar por puro paso del
 *     tiempo. **Sin definir = apagado**, que es el default deliberado.
 *
 * Cada tenant es independiente: un fallo en uno no interrumpe los demás.
 * Usa `CronLockService` para no correr dos veces en simultáneo.
 */

import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { eq } from 'drizzle-orm';
import { tenants, type ControlDb, type Tenant } from '@casino/db';
import { CONTROL_DB } from '../database/database.module';
import { TenantConnectionCache } from '../tenant-resolver/tenant-connection-cache';
import { CronLockService } from '../cron-lock/cron-lock.service';
import {
  DEFAULT_SESSION_IDLE_HOURS,
  RoundsReconciliationService,
  type ReconciliationSummary,
} from './rounds-reconciliation.service';

const DEFAULT_CRON = '*/10 * * * *';

@Injectable()
export class RoundsReconciliationCron {
  private readonly logger = new Logger(RoundsReconciliationCron.name);
  private running = false;
  private readonly enabled: boolean;

  constructor(
    private readonly config: ConfigService,
    @Inject(CONTROL_DB) private readonly controlDb: ControlDb,
    private readonly connectionCache: TenantConnectionCache,
    private readonly service: RoundsReconciliationService,
    private readonly scheduler: SchedulerRegistry,
    private readonly cronLock: CronLockService,
  ) {
    this.enabled = config.get<string>('ROUNDS_RECON_ENABLED') !== 'false';
    if (!this.enabled) {
      this.logger.warn(
        'RoundsReconciliationCron DESHABILITADO via ROUNDS_RECON_ENABLED=false.',
      );
      return;
    }
    this.registerCron();
  }

  private registerCron(): void {
    const cronExpr = this.config.get<string>('ROUNDS_RECON_CRON') ?? DEFAULT_CRON;
    const job = new CronJob(cronExpr, () => {
      void this.cronLock
        .runExclusive('rounds-reconciliation', () =>
          this.runForAllTenants().then(() => undefined),
        )
        .catch((err) => {
          this.logger.error(
            `Cron runForAllTenants tiró: ${(err as Error).message}`,
          );
        });
    });
    this.scheduler.addCronJob('rounds-reconciliation', job);
    job.start();

    const stale = this.staleHours();
    this.logger.log(
      `RoundsReconciliationCron registrado schedule="${cronExpr}" ` +
        `idleHours=${this.idleHours()} ` +
        `staleHours=${stale === null ? 'apagado' : stale}.`,
    );
  }

  private idleHours(): number {
    const raw = Number(this.config.get<string>('ROUNDS_RECON_IDLE_HOURS'));
    return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_SESSION_IDLE_HOURS;
  }

  /** `null` = regla de último recurso apagada. Es el default. */
  private staleHours(): number | null {
    const bruto = this.config.get<string>('ROUNDS_RECON_STALE_HOURS');
    if (bruto === undefined || bruto === '') return null;
    const n = Number(bruto);
    return Number.isFinite(n) && n > 0 ? n : null;
  }

  async runForAllTenants(): Promise<
    Array<{ tenantSlug: string; resumen: ReconciliationSummary }>
  > {
    if (this.running) {
      this.logger.warn('runForAllTenants saltado: run previo todavía activo.');
      return [];
    }
    this.running = true;
    const salida: Array<{ tenantSlug: string; resumen: ReconciliationSummary }> = [];
    try {
      const activos: Tenant[] = await this.controlDb
        .select()
        .from(tenants)
        .where(eq(tenants.status, 'active'));

      const opts = {
        sessionIdleHours: this.idleHours(),
        staleHours: this.staleHours(),
      };

      for (const tenant of activos) {
        try {
          const db = this.connectionCache.get(tenant);
          const resumen = await this.service.runForTenant(db, opts);
          salida.push({ tenantSlug: tenant.slug, resumen });
        } catch (err) {
          this.logger.error(
            `Reconciliación de rondas del tenant ${tenant.slug} falló: ` +
              `${(err as Error).message}`,
          );
        }
      }
    } finally {
      this.running = false;
    }
    return salida;
  }
}
