/**
 * RoundsReconciliationCron — corre la red de seguridad de rondas en todos los
 * tenants activos.
 *
 * El "por qué" está en `RoundsReconciliationService`. En resumen: el proveedor
 * resuelve sus rondas solo (el jugador vuelve, o se cancela con reembolso), y
 * puede tardar hasta una semana. Este job **no** es el mecanismo normal: sólo
 * levanta las que quedaron sin resolver mucho después de eso.
 *
 * Configuración:
 *   - `ROUNDS_RECON_CRON` — expresión cron. Default: cada hora en punto. No
 *     hace falta más seguido: nada se cierra antes de 10 días.
 *   - `ROUNDS_RECON_ENABLED=false` — lo apaga (tests, debug).
 *   - `ROUNDS_RECON_MIN_AGE_DAYS` — antigüedad mínima de la ronda para ser
 *     candidata. Default 10. **Es la protección principal**: bajarlo arriesga
 *     cerrar rondas que el proveedor todavía puede reembolsar.
 *   - `ROUNDS_RECON_IDLE_HOURS` — inactividad para marcar NUESTRA sesión como
 *     expirada. Default 2. Sólo higiene de datos; no cierra rondas por sí solo.
 *   - `ROUNDS_RECON_CLOSE_WITHOUT_EVIDENCE=true` — cerrar por sola antigüedad,
 *     sin ninguna otra señal. Apagado por defecto.
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
  DEFAULT_MIN_AGE_DAYS,
  DEFAULT_SESSION_IDLE_HOURS,
  RoundsReconciliationService,
  type ReconciliationOptions,
  type ReconciliationSummary,
} from './rounds-reconciliation.service';

const DEFAULT_CRON = '0 * * * *';

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

    const o = this.opciones();
    this.logger.log(
      `RoundsReconciliationCron registrado schedule="${cronExpr}" ` +
        `minAgeDays=${o.minAgeDays} idleHours=${o.sessionIdleHours} ` +
        `sinEvidencia=${o.closeWithoutEvidence ? 'SÍ' : 'no'}.`,
    );
  }

  private numero(clave: string, porDefecto: number): number {
    const n = Number(this.config.get<string>(clave));
    return Number.isFinite(n) && n > 0 ? n : porDefecto;
  }

  private opciones(): ReconciliationOptions {
    return {
      minAgeDays: this.numero('ROUNDS_RECON_MIN_AGE_DAYS', DEFAULT_MIN_AGE_DAYS),
      sessionIdleHours: this.numero(
        'ROUNDS_RECON_IDLE_HOURS',
        DEFAULT_SESSION_IDLE_HOURS,
      ),
      closeWithoutEvidence:
        this.config.get<string>('ROUNDS_RECON_CLOSE_WITHOUT_EVIDENCE') === 'true',
    };
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

      const opts = this.opciones();

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
