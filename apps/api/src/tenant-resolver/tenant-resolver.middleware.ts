/**
 * TenantResolverMiddleware — identifica el tenant del request por su Host header.
 *
 * Flujo:
 *   1. Lee `Host` del request (ej. "demo.localhost:3000").
 *   2. Normaliza (lowercase, sin puerto).
 *   3. Busca en `tenant_domains` de la DB de control.
 *   4. Si hay match y tenant.status === 'active' → adjunta tenantContext al request.
 *   5. Si no match → no falla, deja seguir (algunos endpoints como /platform/* no
 *      necesitan tenant).
 *   6. Si match pero tenant suspendido/eliminado → 403.
 *
 * Performance: queryea control DB en cada request. Para producción con tráfico
 * alto, agregar caché Redis (ver docs/13-escalabilidad.md §8.2).
 */

import { Inject, Injectable, type NestMiddleware, ForbiddenException } from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';
import { eq } from 'drizzle-orm';
import { tenants, tenantDomains, type ControlDb } from '@casino/db';
import { CONTROL_DB } from '../database/database.module';
import { TenantConnectionCache } from './tenant-connection-cache';
import type { RequestWithTenantContext } from './tenant-context';

@Injectable()
export class TenantResolverMiddleware implements NestMiddleware {
  constructor(
    @Inject(CONTROL_DB) private readonly controlDb: ControlDb,
    private readonly cache: TenantConnectionCache,
  ) {}

  async use(req: Request, _res: Response, next: NextFunction): Promise<void> {
    const host = this.extractHost(req);
    if (!host) {
      // Sin host header (raro) — seguimos sin context.
      next();
      return;
    }

    // Lookup: domain → tenant.
    const rows = await this.controlDb
      .select({
        tenant: tenants,
      })
      .from(tenantDomains)
      .innerJoin(tenants, eq(tenants.id, tenantDomains.tenantId))
      .where(eq(tenantDomains.domain, host))
      .limit(1);

    const found = rows[0];
    if (!found) {
      // Host no asociado a ningún tenant. Continuamos — endpoints que
      // requieran tenant van a rechazar después.
      next();
      return;
    }

    const tenant = found.tenant;

    if (tenant.status === 'deleted') {
      throw new ForbiddenException('Tenant eliminado.');
    }
    if (tenant.status === 'suspended') {
      throw new ForbiddenException('Tenant suspendido.');
    }
    if (tenant.status !== 'active') {
      // onboarding u otro: rechazar para forzar a quien provisiona a marcarlo active.
      throw new ForbiddenException(`Tenant en estado "${tenant.status}".`);
    }

    const tenantDb = this.cache.get(tenant);

    (req as RequestWithTenantContext).tenantContext = {
      tenant,
      db: tenantDb,
    };

    next();
  }

  /**
   * Saca el host del request, sin puerto, lowercase.
   *
   * Prioridad de headers:
   *   1. `X-Tenant-Host` — override EXPLÍCITO del cliente. Útil para SPA
   *      (frontend en :3001 hablando con backend en :3000) — Next.js
   *      pisa `X-Forwarded-Host` al hacer rewrite, así que necesitamos
   *      un header que NO esté reservado.
   *   2. `X-Forwarded-Host` — header estándar de reverse proxies. En
   *      prod, Nginx/Cloudflare lo setea con el host real del cliente.
   *   3. `Host` — header HTTP normal. En prod corresponde al subdomain
   *      del tenant (e.g. `demo.casino-platform.com`).
   *
   * Trust model: en dev confiamos sin restricción. En prod, el reverse
   * proxy de borde debe sanear cualquier `X-Tenant-Host` o
   * `X-Forwarded-*` externo entrante (anti-spoofing).
   *
   * Ej: "Demo.LocalHost:3000" → "demo.localhost".
   */
  private extractHost(req: Request): string | null {
    const tenantHost = req.header('x-tenant-host');
    const forwarded = req.header('x-forwarded-host');
    const raw = tenantHost ?? forwarded ?? req.header('host');
    if (!raw) return null;
    const withoutPort = raw.split(':')[0]?.toLowerCase();
    return withoutPort ?? null;
  }
}
