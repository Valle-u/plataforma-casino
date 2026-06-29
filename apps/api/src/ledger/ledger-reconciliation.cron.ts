/**
 * LedgerReconciliationCron — runner nocturno del validador de invariante.
 *
 * Itera todos los tenants activos en `platform_control.tenants` y corre la
 * reconciliación en cada uno. Cada tenant es independiente — un fallo en uno
 * NO interrumpe los demás (try/catch por tenant).
 *
 * Configuración:
 *   - `LEDGER_RECON_CRON` env var = expresión cron (default `0 3 * * *`,
 *     3am UTC — horario de baja actividad).
 *   - `LEDGER_RECON_ENABLED` env var = 'false' deshabilita (tests, debug).
 *
 * Concurrencia: NO corre dos veces en simultáneo (flag `running` interno).
 *
 * Política: ante un descuadre el service SOLO alerta (audit + fila de corrida);
 * el cron nunca bloquea operaciones.
 */

import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { eq } from 'drizzle-orm';
import { tenants, type ControlDb, type Tenant } from '@casino/db';
import { CONTROL_DB } from '../database/database.module';
import { TenantConnectionCache } from '../tenant-resolver/tenant-connection-cache';
import { LedgerReconciliationService } from './ledger-reconciliation.service';

const DEFAULT_CRON = '0 3 * * *'; // 3am UTC

@Injectable()
export class LedgerReconciliationCron {
  private readonly logger = new Logger(LedgerReconciliationCron.name);
  private running = false;
  private readonly enabled: boolean;

  constructor(
    private readonly config: ConfigService,
    @Inject(CONTROL_DB) private readonly controlDb: ControlDb,
    private readonly connectionCache: TenantConnectionCache,
    private readonly service: LedgerReconciliationService,
    private readonly scheduler: SchedulerRegistry,
  ) {
    this.enabled = config.get<string>('LEDGER_RECON_ENABLED') !== 'false';
    if (!this.enabled) {
      this.logger.warn(
        'LedgerReconciliationCron DISABLED via LEDGER_RECON_ENABLED=false.',
      );
      return;
    }
    this.registerCron();
  }

  /**
   * Registramos el cron programáticamente (no `@Cron(...)` decorator) para
   * que el schedule sea configurable via env.
   */
  private registerCron(): void {
    const cronExpr =
      this.config.get<string>('LEDGER_RECON_CRON') ?? DEFAULT_CRON;
    const job = new CronJob(cronExpr, () => {
      void this.runForAllTenants().catch((err) => {
        this.logger.error(
          `Cron runForAllTenants tiró: ${(err as Error).message}`,
        );
      });
    });
    this.scheduler.addCronJob('ledger-reconciliation', job);
    job.start();
    this.logger.log(
      `LedgerReconciliationCron registrado con schedule="${cronExpr}".`,
    );
  }

  /**
   * Corre la reconciliación para todos los tenants activos. Llamado por el
   * cron. Retorna por tenant el status + cantidad de descuadres (para debug).
   */
  async runForAllTenants(): Promise<
    Array<{
      tenantId: string;
      tenantSlug: string;
      status: string;
      walletsMismatched: number;
      holdsMismatched: number;
    }>
  > {
    if (this.running) {
      this.logger.warn('runForAllTenants saltado: run previo todavía activo.');
      return [];
    }
    this.running = true;
    const results: Array<{
      tenantId: string;
      tenantSlug: string;
      status: string;
      walletsMismatched: number;
      holdsMismatched: number;
    }> = [];
    try {
      const activeTenants: Tenant[] = await this.controlDb
        .select()
        .from(tenants)
        .where(eq(tenants.status, 'active'));

      this.logger.log(
        `Ledger reconciliation: iterando ${activeTenants.length} tenants activos.`,
      );

      for (const tenant of activeTenants) {
        try {
          const tenantDb = this.connectionCache.get(tenant);
          const run = await this.service.runReconciliation(tenantDb, {
            trigger: 'cron',
          });
          results.push({
            tenantId: tenant.id,
            tenantSlug: tenant.slug,
            status: run.status,
            walletsMismatched: run.walletsMismatched,
            holdsMismatched: run.holdsMismatched,
          });
        } catch (err) {
          this.logger.error(
            `Reconciliación de tenant ${tenant.slug} (${tenant.id}) falló: ${(err as Error).message}`,
          );
        }
      }
    } finally {
      this.running = false;
    }
    return results;
  }
}
