/**
 * TenantInfoController — endpoint público de bootstrap del player web.
 *
 * Muestra que el TenantResolverMiddleware funciona correctamente: el endpoint
 * lee el `tenantContext` del request y devuelve info básica + un check vivo
 * a la DB del tenant.
 *
 * **Sprint 29**: además devuelve `branding` (color + logo) leído de
 * `tenant_settings`. El player web hace fetch acá al bootstrap para
 * aplicar el theming del tenant (CSS var --color-accent override + logo
 * en el header + favicon dinámico).
 *
 * Sin auth (público) para facilitar testing + permitir bootstrap del player
 * antes del login. En producción este shape se mantiene público: el slug y
 * el name no son secretos (visibles en el dominio igual), y el branding es
 * info pública por diseño.
 *
 * Ejemplo de uso:
 *   curl -H "Host: demo.localhost" http://localhost:3000/tenant/info
 */

import { Controller, Get, Header, NotFoundException, Req } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type {
  RequestWithTenantContext,
  TenantDb,
} from '../tenant-resolver/tenant-context';
import { TenantSettingsService } from '../tenant-settings/tenant-settings.service';

/**
 * Shape del bloque branding que devuelve el endpoint. Cada campo es
 * opcional — si el admin no lo setteó, el frontend usa los defaults
 * del DS. NO devolvemos errores de parsing si los settings están en
 * un formato inesperado: leemos defensivo y, si falla, omitimos el
 * campo.
 */
interface BrandingSnapshot {
  primaryColor: string | null;
  logoUrl: string | null;
}

interface DesignSnapshot {
  slides: unknown;
  colors: unknown;
  texts: unknown;
  brand: unknown;
}

@Controller('tenant')
export class TenantInfoController {
  constructor(private readonly settingsService: TenantSettingsService) {}

  /**
   * GET /tenant/info
   * Devuelve info del tenant resuelto + ping a su DB + branding snapshot.
   */
  @Get('info')
  @Header('Cache-Control', 'public, max-age=60, s-maxage=60, stale-while-revalidate=300')
  async getInfo(@Req() req: RequestWithTenantContext): Promise<unknown> {
    if (!req.tenantContext) {
      throw new NotFoundException(
        'No se encontró tenant para este Host. Verificá tenant_domains en la DB de control.',
      );
    }

    const { tenant, db } = req.tenantContext;

    // Ping vivo: ejecutamos una query trivial contra la DB del tenant.
    // Confirma que la conexión está abierta y la DB existe.
    const pingResult = await db.execute(
      sql`SELECT current_database() AS db_name, now() AS db_now`,
    );
    const ping = pingResult[0] as
      | { db_name: string; db_now: Date }
      | undefined;

    // Branding: leemos defensivo de tenant_settings. Si el valor no
    // matchea el shape esperado (string), devolvemos null y dejamos
    // que el frontend caiga al default. NO bloqueamos el endpoint por
    // un setting malformado.
    const branding = await this.loadBranding(db);

    return {
      tenant: {
        id: tenant.id,
        slug: tenant.slug,
        name: tenant.name,
        status: tenant.status,
        planId: tenant.planId,
      },
      // Sprint 51.10 (OWASP A05): no exponemos `db_name` interno
      // (ej. `tenant_demo_dev`) — leakea convención de naming y facilita
      // ataques dirigidos si emerge SQLi/SSRF. El cliente solo necesita
      // saber que la DB respondió al ping; el `currentTime` sirve para
      // detectar desync de reloj client/server (UX). El backend si
      // necesita el nombre interno lo tiene en `tenant.dbName` con
      // permisos de admin.
      tenantDb: {
        connected: ping !== null,
        currentTime: ping?.db_now ?? null,
      },
      branding,
      design: await this.loadDesignConfig(db),
      message: '✅ Tenant resuelto correctamente desde Host header.',
    };
  }

  private async loadBranding(db: TenantDb): Promise<BrandingSnapshot> {
    const [primaryColor, logoUrl] = await Promise.all([
      this.settingsService.get<string>(db, 'branding.primary_color'),
      this.settingsService.get<string>(db, 'branding.logo_url'),
    ]);
    return {
      primaryColor: typeof primaryColor === 'string' ? primaryColor : null,
      logoUrl: typeof logoUrl === 'string' ? logoUrl : null,
    };
  }

  private async loadDesignConfig(db: TenantDb): Promise<DesignSnapshot | null> {
    try {
      const raw = await this.settingsService.get<unknown>(db, 'design.config');
      if (!raw || typeof raw !== 'object') return null;
      const r = raw as Record<string, unknown>;
      return {
        slides: r.slides ?? null,
        colors: r.colors ?? null,
        texts: r.texts ?? null,
        brand: r.brand ?? null,
      };
    } catch {
      return null;
    }
  }
}
