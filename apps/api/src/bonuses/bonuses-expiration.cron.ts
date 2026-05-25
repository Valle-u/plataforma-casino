/**
 * BonusesExpirationCron — runner periódico para `BonusesExpirationService`.
 *
 * Itera todos los tenants activos en `platform_control.tenants` y ejecuta
 * el job de expiración en cada uno. Cada tenant es independiente — un
 * fallo en uno NO interrumpe los demás (cada uno tiene su try/catch).
 *
 * Configuración:
 *   - `BONUSES_EXPIRE_CRON` env var = expresión cron (default `0 0 * * *`).
 *   - `BONUSES_EXPIRE_ENABLED` env var = 'false' deshabilita (tests, debug).
 *
 * Concurrencia: NO corre dos veces simultáneo. Si un run no termina antes
 * del próximo trigger, el segundo se salta (flag `running` interno). Esto
 * previene pisarse a sí mismo si en producción hay muchos tenants y
 * cada run tarda más que el período.
 *
 * Multi-instance: si en el futuro hay múltiples API instances, este cron
 * correría en todas y procesaría los mismos bonos. La idempotency del
 * wallet revert (`bonus_expire:<id>`) lo blinda, pero hay desperdicio
 * de trabajo. Mejor: dedicado worker o lock distribuido. Por ahora
 * single-instance.
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
  BonusesExpirationService,
  type ExpirationRunResult,
} from './bonuses-expiration.service';

const DEFAULT_CRON = '0 0 * * *'; // medianoche UTC

@Injectable()
export class BonusesExpirationCron {
  private readonly logger = new Logger(BonusesExpirationCron.name);
  private running = false;
  private readonly enabled: boolean;

  constructor(
    private readonly config: ConfigService,
    @Inject(CONTROL_DB) private readonly controlDb: ControlDb,
    private readonly connectionCache: TenantConnectionCache,
    private readonly expirationService: BonusesExpirationService,
    private readonly scheduler: SchedulerRegistry,
  ) {
    this.enabled = config.get<string>('BONUSES_EXPIRE_ENABLED') !== 'false';
    if (!this.enabled) {
      this.logger.warn(
        'BonusesExpirationCron DISABLED via BONUSES_EXPIRE_ENABLED=false.',
      );
      return;
    }
    this.registerCron();
  }

  /**
   * Registramos el cron programáticamente en lugar de usar `@Cron(...)`
   * decorator porque queremos que el schedule sea configurable via env
   * (los decoradores requieren string constante).
   */
  private registerCron(): void {
    const cronExpr = this.config.get<string>('BONUSES_EXPIRE_CRON') ?? DEFAULT_CRON;
    const job = new CronJob(cronExpr, () => {
      void this.runForAllTenants().catch((err) => {
        this.logger.error(
          `Cron runForAllTenants tiró: ${(err as Error).message}`,
        );
      });
    });
    this.scheduler.addCronJob('bonuses-expire', job);
    job.start();
    this.logger.log(`BonusesExpirationCron registrado con schedule="${cronExpr}".`);
  }

  /**
   * Ejecuta el job para todos los tenants activos. Llamado por el cron
   * O manualmente vía endpoint admin (sprint-cron #endpoint).
   *
   * Retorna por tenant cuántos bonos procesó. Útil para test + debug.
   */
  async runForAllTenants(): Promise<
    Array<{ tenantId: string; tenantSlug: string; result: ExpirationRunResult }>
  > {
    if (this.running) {
      this.logger.warn('runForAllTenants saltado: run previo todavía activo.');
      return [];
    }
    this.running = true;
    const results: Array<{
      tenantId: string;
      tenantSlug: string;
      result: ExpirationRunResult;
    }> = [];
    try {
      const activeTenants: Tenant[] = await this.controlDb
        .select()
        .from(tenants)
        .where(eq(tenants.status, 'active'));

      this.logger.log(`Bonuses expiration: iterando ${activeTenants.length} tenants activos.`);

      for (const tenant of activeTenants) {
        try {
          const tenantDb = this.connectionCache.get(tenant);
          const result = await this.expirationService.expireDueForTenant(tenantDb);
          results.push({ tenantId: tenant.id, tenantSlug: tenant.slug, result });
        } catch (err) {
          this.logger.error(
            `Expiration de tenant ${tenant.slug} (${tenant.id}) falló: ${(err as Error).message}`,
          );
        }
      }
    } finally {
      this.running = false;
    }
    return results;
  }
}
