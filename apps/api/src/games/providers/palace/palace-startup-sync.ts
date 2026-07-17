/**
 * PalaceStartupSync — sincroniza catálogo de Palace al arrancar la API.
 *
 * OnApplicationBootstrap: después de que todos los módulos están inicializados
 * pero antes de recibir requests. Recorre tenants activos y corre sync para
 * cada uno que tenga palace.api_token configurado.
 *
 * Fire-and-forget: si falla un tenant, loguea y sigue con el siguiente.
 * No bloquea el startup (usa void promise).
 */

import { Injectable, Logger } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { tenants } from '@casino/db';
import type { ControlDb } from '@casino/db';
import { CONTROL_DB } from '../../../database/database.module';
import { TenantConnectionCache } from '../../../tenant-resolver/tenant-connection-cache';
import { PalaceSyncService } from './palace-sync.service';
import { TenantSettingsService } from '../../../tenant-settings/tenant-settings.service';

@Injectable()
export class PalaceStartupSync {
  private readonly logger = new Logger(PalaceStartupSync.name);

  constructor(
    @Inject(CONTROL_DB) private readonly controlDb: ControlDb,
    private readonly connectionCache: TenantConnectionCache,
    private readonly syncService: PalaceSyncService,
    private readonly settingsService: TenantSettingsService,
  ) {}

  /**
   * Called automatically by NestJS after app is fully initialized.
   * Runs sync in background — does not block startup.
   */
  async onApplicationBootstrap(): Promise<void> {
    // Fire-and-forget: run sync in background
    void this.syncAllTenants();
  }

  private async syncAllTenants(): Promise<void> {
    try {
      this.logger.log('Palace startup sync: buscando tenants activos...');

      const activeTenants = await this.controlDb
        .select({
          id: tenants.id,
          slug: tenants.slug,
          dbName: tenants.dbName,
        })
        .from(tenants)
        .where(eq(tenants.status, 'active'));

      this.logger.log(`Palace startup sync: ${activeTenants.length} tenants activos`);

      for (const tenant of activeTenants) {
        try {
          // Check if this tenant has palace.api_token configured
          const db = this.connectionCache.get(tenant as any);
          const token = await this.settingsService.get<string>(db, 'palace.api_token');

          if (!token) {
            this.logger.debug(`Palace startup sync: tenant ${tenant.slug} sin palace.api_token, skip`);
            continue;
          }

          this.logger.log(`Palace startup sync: sincronizando tenant ${tenant.slug}...`);
          const result = await this.syncService.syncGames(db);
          this.logger.log(
            `Palace startup sync: ${tenant.slug} → ${result.fetched} juegos, ${result.created} nuevos, ${result.updated} actualizados`,
          );
        } catch (err) {
          this.logger.error(`Palace startup sync: error en tenant ${tenant.slug}: ${(err as Error).message}`);
        }
      }

      this.logger.log('Palace startup sync: completado');
    } catch (err) {
      this.logger.error(`Palace startup sync: error general: ${(err as Error).message}`);
    }
  }
}
