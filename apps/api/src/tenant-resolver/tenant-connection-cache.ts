/**
 * TenantConnectionCache — cache en memoria de clientes Drizzle por tenant.
 *
 * MVP: simple Map indexado por tenant.id. Las conexiones se mantienen vivas
 * mientras el proceso esté arriba.
 *
 * Trade-offs conocidos (para v1+):
 *   - Sin LRU eviction → si tenemos 1000 tenants, mantenemos 1000 pools abiertos.
 *     Ver `docs/13-escalabilidad.md §6.2` para la estrategia LRU completa.
 *   - Sin invalidación reactiva → si un tenant cambia su `dbHost` (sharding),
 *     hay que reiniciar el server o agregar mecanismo de invalidación.
 *
 * Para Fase 1-2 con pocos tenants, este cache simple alcanza.
 */

import { Injectable, Logger, type OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createTenantDb, type Tenant } from '@casino/db';
import type { TenantDb } from './tenant-context';

/**
 * Acceso al cliente postgres-js subyacente para poder cerrarlo en shutdown.
 * drizzle-orm expone `$client` desde v0.30+ — si la API cambia, este tipo
 * y el `closeAll()` debajo se rompen explícitamente al compilar.
 */
interface DrizzleWithClient {
  $client: { end: () => Promise<void> };
}

@Injectable()
export class TenantConnectionCache implements OnApplicationShutdown {
  private readonly logger = new Logger(TenantConnectionCache.name);
  private readonly cache = new Map<string, TenantDb>();

  constructor(private readonly config: ConfigService) {}

  /**
   * Devuelve un cliente Drizzle conectado a la DB del tenant. Si ya existe
   * en cache, lo reusa. Si no, lo crea.
   */
  get(tenant: Tenant): TenantDb {
    const cached = this.cache.get(tenant.id);
    if (cached) return cached;

    const template = this.config.get<string>('DATABASE_URL_TENANT_TEMPLATE');
    if (!template) {
      throw new Error(
        'DATABASE_URL_TENANT_TEMPLATE no está configurado en .env.local',
      );
    }

    // Reemplazamos el placeholder <tenant_db> por el dbName real.
    // El host del template puede ser distinto al de tenant.dbHost en el futuro
    // (cuando shardeemos a otros hosts) — manejamos eso como mejora.
    const url = template.replace('<tenant_db>', tenant.dbName);

    const db = createTenantDb(url);
    this.cache.set(tenant.id, db);
    return db;
  }

  /** Invalida el cache para un tenant específico (útil al cambiar host). */
  invalidate(tenantId: string): void {
    this.cache.delete(tenantId);
  }

  /** Limpia todo el cache (sin cerrar conexiones — usar closeAll() para eso). */
  clear(): void {
    this.cache.clear();
  }

  /**
   * Cierra TODAS las conexiones cacheadas y vacía el cache. Llamado
   * automáticamente por NestJS en shutdown (vía `OnApplicationShutdown`).
   *
   * En tests, además, `app.close()` lo dispara, evitando handles abiertos
   * que mantienen Jest vivo.
   */
  async closeAll(): Promise<void> {
    const entries = Array.from(this.cache.values());
    this.cache.clear();
    await Promise.all(
      entries.map(async (db) => {
        try {
          await (db as unknown as DrizzleWithClient).$client.end();
        } catch (err) {
          this.logger.warn(`Error cerrando conexión tenant: ${(err as Error).message}`);
        }
      }),
    );
  }

  async onApplicationShutdown(): Promise<void> {
    await this.closeAll();
  }
}
