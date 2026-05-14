/**
 * NotificationsDispatcherCron — procesa notifs pendientes.
 *
 * Mismo patrón que los otros crons del proyecto: programmatic
 * registration, multi-tenant iteration, env disable para tests, lock
 * `running` para evitar superposición.
 *
 * Schedule default: cada 5 minutos. Más frecuente que retention/fraud
 * porque las notifs son user-facing y queremos latencia baja
 * (especialmente in_app — aunque in_app no pasa por dispatcher, las
 * email/sms sí).
 *
 * Retention: el cron también purga notifs viejas (sent/read/failed
 * con `created_at < NOW() - notifications.retention_days`, default
 * 180d). Patrón análogo a tenant-settings-history-retention pero
 * embebido en el mismo cron (no necesita schedule separado — purga
 * es rápida).
 */

import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { eq } from 'drizzle-orm';
import { tenants, type ControlDb, type Tenant } from '@casino/db';
import { CONTROL_DB } from '../database/database.module';
import { TenantConnectionCache } from '../tenant-resolver/tenant-connection-cache';
import { TenantSettingsService } from '../tenant-settings/tenant-settings.service';
import { NotificationsService } from './notifications.service';
import type { TenantDb } from '../tenant-resolver/tenant-context';

const DEFAULT_CRON = '*/5 * * * *'; // every 5 minutes
const DEFAULT_RETENTION_DAYS = 180;
const BATCH_SIZE = 200;

export interface DispatcherRunResult {
  tenantId: string;
  tenantSlug: string;
  processed: number;
  sent: number;
  failed: number;
  purged: number;
}

@Injectable()
export class NotificationsDispatcherCron {
  private readonly logger = new Logger(NotificationsDispatcherCron.name);
  private running = false;
  private readonly enabled: boolean;

  constructor(
    private readonly config: ConfigService,
    @Inject(CONTROL_DB) private readonly controlDb: ControlDb,
    private readonly connectionCache: TenantConnectionCache,
    private readonly notificationsService: NotificationsService,
    private readonly settingsService: TenantSettingsService,
    private readonly scheduler: SchedulerRegistry,
  ) {
    this.enabled =
      config.get<string>('NOTIFICATIONS_DISPATCHER_ENABLED') !== 'false';
    if (!this.enabled) {
      this.logger.warn('NotificationsDispatcherCron DISABLED via env.');
      return;
    }
    this.registerCron();
  }

  private registerCron(): void {
    const cronExpr =
      this.config.get<string>('NOTIFICATIONS_DISPATCHER_CRON') ?? DEFAULT_CRON;
    const job = new CronJob(cronExpr, () => {
      void this.runForAllTenants().catch((err) => {
        this.logger.error(`Cron tiró: ${(err as Error).message}`);
      });
    });
    this.scheduler.addCronJob('notifications-dispatcher', job);
    job.start();
    this.logger.log(
      `NotificationsDispatcherCron registrado schedule="${cronExpr}".`,
    );
  }

  async runForAllTenants(): Promise<DispatcherRunResult[]> {
    if (this.running) {
      this.logger.warn('runForAllTenants saltado: run previo todavía activo.');
      return [];
    }
    this.running = true;
    const out: DispatcherRunResult[] = [];
    try {
      const activeTenants: Tenant[] = await this.controlDb
        .select()
        .from(tenants)
        .where(eq(tenants.status, 'active'));

      this.logger.log(
        `Notifications dispatcher: iterando ${activeTenants.length} tenants.`,
      );

      for (const tenant of activeTenants) {
        try {
          const tenantDb = this.connectionCache.get(tenant);
          const result = await this.runForTenant(tenantDb, tenant.slug);
          out.push({
            tenantId: tenant.id,
            tenantSlug: tenant.slug,
            ...result,
          });
        } catch (err) {
          this.logger.error(
            `Dispatcher tenant ${tenant.slug}: ${(err as Error).message}`,
          );
        }
      }
    } finally {
      this.running = false;
    }
    return out;
  }

  /**
   * Procesa pendings + purga viejas para un tenant específico. Llamado
   * por el cron iterator Y por endpoint admin si querés disparo manual
   * (futuro).
   *
   * Si `notifications.email_enabled` es false, NO procesa email
   * pendings (quedan en pending para retry futuro cuando el admin
   * habilite). Patrón de "kill switch" sin perder el queue.
   */
  async runForTenant(
    db: TenantDb,
    tenantSlug: string,
  ): Promise<{ processed: number; sent: number; failed: number; purged: number }> {
    const emailEnabled = await this.settingsService.get<boolean>(
      db,
      'notifications.email_enabled',
    );

    let processed = 0;
    let sent = 0;
    let failed = 0;

    if (emailEnabled !== false) {
      // Default = enabled (undefined cuenta como enabled).
      const result = await this.notificationsService.dispatch(
        db,
        tenantSlug,
        BATCH_SIZE,
      );
      processed = result.processed;
      sent = result.sent;
      failed = result.failed;
    } else {
      this.logger.debug(
        `Dispatcher tenant=${tenantSlug}: email_enabled=false. Skip envío.`,
      );
    }

    // Retention purge.
    const retentionDays = await this.settingsService.getNumeric(
      db,
      'notifications.retention_days',
      DEFAULT_RETENTION_DAYS,
    );
    const purged = await this.notificationsService.purgeOld(db, retentionDays);
    if (purged > 0) {
      this.logger.log(
        `Notifs tenant=${tenantSlug}: purgadas ${purged} viejas (retention=${retentionDays}d).`,
      );
    }

    return { processed, sent, failed, purged };
  }
}
