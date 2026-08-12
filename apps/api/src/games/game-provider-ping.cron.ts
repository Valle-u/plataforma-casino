/**
 * GameProviderPingCron — healthcheck periódico de los proveedores de juegos.
 *
 * Cada ~5 min pinguea al proveedor de cada tenant (solo si tiene credenciales
 * configuradas) y, en la transición a offline, registra log + alerta al admin.
 * Mismo patrón multi-tenant que los otros crons (programmatic registration,
 * env disable para tests).
 *
 * Env vars:
 *   - GAME_PROVIDER_PING_ENABLED: 'false' para deshabilitar (default 'true').
 *   - GAME_PROVIDER_PING_CRON: expresión cron (default cada 5 min).
 */

import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { eq } from 'drizzle-orm';
import { tenants, type ControlDb, type Tenant } from '@casino/db';
import { CONTROL_DB } from '../database/database.module';
import { TenantConnectionCache } from '../tenant-resolver/tenant-connection-cache';
import { GameProvidersService } from './game-providers.service';

const DEFAULT_CRON = '*/5 * * * *'; // cada 5 minutos
const PROVIDER_CODE = 'palace'; // MVP: único proveedor.

@Injectable()
export class GameProviderPingCron {
  private readonly logger = new Logger(GameProviderPingCron.name);
  private running = false;
  private readonly enabled: boolean;

  constructor(
    private readonly config: ConfigService,
    @Inject(CONTROL_DB) private readonly controlDb: ControlDb,
    private readonly connectionCache: TenantConnectionCache,
    private readonly providers: GameProvidersService,
    private readonly scheduler: SchedulerRegistry,
  ) {
    this.enabled =
      config.get<string>('GAME_PROVIDER_PING_ENABLED') !== 'false';
    if (!this.enabled) {
      this.logger.warn('GameProviderPingCron DISABLED via env.');
      return;
    }
    this.registerCron();
  }

  private registerCron(): void {
    const cronExpr =
      this.config.get<string>('GAME_PROVIDER_PING_CRON') ?? DEFAULT_CRON;
    const job = new CronJob(cronExpr, () => {
      void this.runForAllTenants().catch((err) => {
        this.logger.error(`Ping cron tiró: ${(err as Error).message}`);
      });
    });
    this.scheduler.addCronJob('game-provider-ping', job);
    job.start();
    this.logger.log(`GameProviderPingCron registrado schedule="${cronExpr}".`);
  }

  async runForAllTenants(): Promise<void> {
    if (this.running) {
      this.logger.debug('Ping run saltado: run previo todavía activo.');
      return;
    }
    this.running = true;
    try {
      const activeTenants: Tenant[] = await this.controlDb
        .select()
        .from(tenants)
        .where(eq(tenants.status, 'active'));

      for (const tenant of activeTenants) {
        try {
          const tenantDb = this.connectionCache.get(tenant);
          await this.providers.pingAndAlert(tenantDb, PROVIDER_CODE);
        } catch (err) {
          this.logger.warn(
            `Ping tenant ${tenant.slug}: ${(err as Error).message}`,
          );
        }
      }
    } finally {
      this.running = false;
    }
  }
}
