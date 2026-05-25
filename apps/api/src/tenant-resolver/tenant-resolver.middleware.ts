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
 * Sprint 53.5 perf fix:
 *   Antes este middleware queryeaba la control DB en CADA request — bajo
 *   carga (spike test 200 VUs) era el bottleneck principal (p95 2.3s).
 *   Agregado cache en memoria con TTL 5 min: hit rate ~99% con dataset
 *   estable de hosts. El admin que cambie un host puede invalidar via
 *   `invalidateHost()` (futuro: hookear al endpoint de update).
 *
 *   Negative caching: hosts no encontrados también se cachean (TTL más
 *   corto, 30s) para evitar que scans externos disparen N queries.
 */

import { Inject, Injectable, type NestMiddleware, ForbiddenException } from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';
import { eq } from 'drizzle-orm';
import { tenants, tenantDomains, type ControlDb, type Tenant } from '@casino/db';
import { CONTROL_DB } from '../database/database.module';
import { TenantConnectionCache } from './tenant-connection-cache';
import type { RequestWithTenantContext } from './tenant-context';

const HOST_CACHE_TTL_MS = 5 * 60 * 1000; // 5 min para hosts válidos
const NEGATIVE_CACHE_TTL_MS = 30 * 1000; // 30s para hosts no encontrados

type CacheEntry =
  | { kind: 'hit'; tenant: Tenant; expiresAt: number }
  | { kind: 'miss'; expiresAt: number };

@Injectable()
export class TenantResolverMiddleware implements NestMiddleware {
  // Cache shared a nivel de instancia (NestJS hace singleton del provider).
  // Single-process: 100% hit rate después del warm. Multi-process: cada
  // worker tiene su cache, sigue siendo bueno.
  private readonly hostCache = new Map<string, CacheEntry>();

  constructor(
    @Inject(CONTROL_DB) private readonly controlDb: ControlDb,
    private readonly cache: TenantConnectionCache,
  ) {}

  /**
   * Invalida cache para un host específico. Llamar cuando admin cambia
   * domain de un tenant (futuro hook desde tenant settings update).
   */
  invalidateHost(host: string): void {
    this.hostCache.delete(host.toLowerCase());
  }

  /** Limpia todo el cache (testing / tenant suspendido / etc.). */
  invalidateAll(): void {
    this.hostCache.clear();
  }

  async use(req: Request, _res: Response, next: NextFunction): Promise<void> {
    const host = this.extractHost(req);
    if (!host) {
      // Sin host header (raro) — seguimos sin context.
      next();
      return;
    }

    // Cache lookup primero.
    const cached = this.hostCache.get(host);
    const now = Date.now();
    if (cached && cached.expiresAt > now) {
      if (cached.kind === 'miss') {
        next();
        return;
      }
      // Hit: usar el tenant cacheado. Re-checkeamos status por las
      // dudas — pasa rarísimo que cambie pero la pena es nula.
      this.attachContext(req, cached.tenant);
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
      // Negative cache: hosts no asociados (scans externos, typos).
      this.hostCache.set(host, {
        kind: 'miss',
        expiresAt: now + NEGATIVE_CACHE_TTL_MS,
      });
      next();
      return;
    }

    const tenant = found.tenant;

    // Cachear hit (independiente de status — el check lo hacemos
    // siempre, así si suspenden un tenant entre cache hits, el rechazo
    // ocurre igual).
    this.hostCache.set(host, {
      kind: 'hit',
      tenant,
      expiresAt: now + HOST_CACHE_TTL_MS,
    });

    this.attachContext(req, tenant);
    next();
  }

  /**
   * Valida status + adjunta el TenantContext (db cacheada + tenant) al
   * request. Extraído porque tanto el cache hit como el lookup fresh
   * lo usan idénticamente.
   */
  private attachContext(req: Request, tenant: Tenant): void {
    if (tenant.status === 'deleted') {
      throw new ForbiddenException('Tenant eliminado.');
    }
    if (tenant.status === 'suspended') {
      throw new ForbiddenException('Tenant suspendido.');
    }
    if (tenant.status !== 'active') {
      throw new ForbiddenException(`Tenant en estado "${tenant.status}".`);
    }

    const tenantDb = this.cache.get(tenant);
    (req as RequestWithTenantContext).tenantContext = {
      tenant,
      db: tenantDb,
    };
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
