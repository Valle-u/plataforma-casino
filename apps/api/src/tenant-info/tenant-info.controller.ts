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
import { PartnerBrandingService } from '../partner-branding/partner-branding.service';
import { panelFromRequest, readCookie } from '../common/cookies';

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
  faviconUrl: string | null;
  tagline: string | null;
}

interface DesignSnapshot {
  slides: unknown;
  colors: unknown;
  texts: unknown;
  brand: unknown;
}

/**
 * Config operativa pública del sitio jugador. Se lee de tenant_settings
 * defensivo — si un valor está malformado, se omite (el frontend cae al
 * default). `deposits.min` y `withdrawals.min` son montos FIAT en la
 * moneda del tenant.
 */
interface SiteConfigSnapshot {
  maintenanceEnabled: boolean;
  registrationEnabled: boolean;
  announcementText: string | null;
  /** Si el teléfono es obligatorio al registrarse (default true). */
  phoneRequired: boolean;
}

interface LimitsSnapshot {
  depositMin: number | null;
  withdrawalMin: number | null;
}

/**
 * Apariencia del panel admin (setting `admin.appearance`). Son 2 "knobs"
 * — color de acento + fondo — desde los que el frontend deriva el resto
 * de la paleta del panel. Se expone público (como branding) porque todos
 * los roles del panel (incluidos los que no pueden editar settings) tienen
 * que verlo aplicado. Si no está configurado, `null` → el panel usa su
 * base neutra + el acento de marca.
 */
interface AdminAppearanceSnapshot {
  accent: string;
  bg: string;
}

@Controller('tenant')
export class TenantInfoController {
  constructor(
    private readonly settingsService: TenantSettingsService,
    private readonly partnerBranding: PartnerBrandingService,
  ) {}

  /**
   * GET /tenant/info
   * Devuelve info del tenant resuelto + ping a su DB + branding snapshot.
   */
  @Get('info')
  // Cache corto: este endpoint expone config operativa del sitio (registro,
  // mantenimiento, teléfono obligatorio, límites). Un cache largo hacía que
  // los cambios del admin tardaran minutos en aplicar en el player. 15s es un
  // buen equilibrio entre carga y propagación.
  @Header('Cache-Control', 'public, max-age=15, s-maxage=15, stale-while-revalidate=30')
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

    // Diseño por socio independiente: si el visitante cuelga de un socio con
    // diseño propio —por su cuenta logueada (token) o por el ?ref= del link de
    // referido— mostramos ESE diseño; si no, el default del tenant. Todo
    // defensivo: cualquier fallo cae al default (resolveForViewer nunca tira).
    const socioConfig = await this.partnerBranding.resolveForViewer(
      db,
      tenant.id,
      { token: this.extractToken(req), refCode: this.extractRefCode(req) },
    );

    // Branding: del socio si tiene diseño propio; si no, defensivo de
    // tenant_settings (valores malformados → null → el frontend usa el default).
    const branding = socioConfig
      ? this.brandingFromConfig(socioConfig)
      : await this.loadBranding(db);
    const design = socioConfig
      ? this.designFromConfig(socioConfig)
      : await this.loadDesignConfig(db);

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
      design,
      adminAppearance: await this.loadAdminAppearance(db),
      site: await this.loadSiteConfig(db),
      limits: await this.loadLimits(db),
      message: '✅ Tenant resuelto correctamente desde Host header.',
    };
  }

  private async loadBranding(db: TenantDb): Promise<BrandingSnapshot> {
    const [primaryColor, logoUrl, faviconUrl, tagline] = await Promise.all([
      this.settingsService.get<string>(db, 'branding.primary_color'),
      this.settingsService.get<string>(db, 'branding.logo_url'),
      // Sprint 55.9: el design page guarda el favicon como espejo legacy
      // en `branding.favicon_url`. Lo exponemos como fallback por si el
      // valor quedó huérfano ahí (no en design.config.brand.faviconUrl).
      this.settingsService.get<string>(db, 'branding.favicon_url'),
      this.settingsService.get<string>(db, 'branding.tagline'),
    ]);
    return {
      primaryColor: typeof primaryColor === 'string' ? primaryColor : null,
      logoUrl: typeof logoUrl === 'string' ? logoUrl : null,
      faviconUrl: typeof faviconUrl === 'string' ? faviconUrl : null,
      tagline: typeof tagline === 'string' ? tagline : null,
    };
  }

  /**
   * Config operativa del sitio jugador. Valores malformados caen al
   * default seguro (site operativo, registros abiertos, sin banner).
   */
  private async loadSiteConfig(db: TenantDb): Promise<SiteConfigSnapshot> {
    const [maintenance, registration, announcement, phoneRequired] =
      await Promise.all([
        this.settingsService.get<unknown>(db, 'site.maintenance_enabled'),
        this.settingsService.get<unknown>(db, 'site.registration_enabled'),
        this.settingsService.get<unknown>(db, 'site.announcement_text'),
        this.settingsService.get<unknown>(db, 'registration.phone_required'),
      ]);
    return {
      maintenanceEnabled: maintenance === true,
      registrationEnabled: registration !== false,
      announcementText:
        typeof announcement === 'string' && announcement.length > 0
          ? announcement
          : null,
      // Default seguro: obligatorio salvo que se haya seteado explícito false.
      phoneRequired: phoneRequired !== false,
    };
  }

  private async loadLimits(db: TenantDb): Promise<LimitsSnapshot> {
    const [depositMin, withdrawalMin] = await Promise.all([
      this.settingsService.get<unknown>(db, 'deposits.min_amount'),
      this.settingsService.get<unknown>(db, 'withdrawals.min_amount'),
    ]);
    return {
      depositMin:
        typeof depositMin === 'number' && Number.isFinite(depositMin)
          ? depositMin
          : null,
      withdrawalMin:
        typeof withdrawalMin === 'number' && Number.isFinite(withdrawalMin)
          ? withdrawalMin
          : null,
    };
  }

  /**
   * Apariencia del panel admin. Lee `admin.appearance` defensivo: si falta
   * o no tiene `accent`/`bg` hex válidos, devuelve null (el panel cae a su
   * base neutra + acento de marca).
   */
  private async loadAdminAppearance(
    db: TenantDb,
  ): Promise<AdminAppearanceSnapshot | null> {
    try {
      const raw = await this.settingsService.get<unknown>(db, 'admin.appearance');
      if (!raw || typeof raw !== 'object') return null;
      const r = raw as Record<string, unknown>;
      const isHex = (v: unknown): v is string =>
        typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v);
      if (!isHex(r.accent) || !isHex(r.bg)) return null;
      return { accent: r.accent, bg: r.bg };
    } catch {
      return null;
    }
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

  /** Token del visitante (opcional): Bearer o cookie httpOnly del player. */
  private extractToken(req: RequestWithTenantContext): string | undefined {
    const authHeader = req.header('authorization');
    if (authHeader?.startsWith('Bearer ')) {
      return authHeader.substring('Bearer '.length).trim();
    }
    return readCookie(req, `casino_${panelFromRequest(req)}_at`);
  }

  /** Código de referido del query (?ref=), si vino. */
  private extractRefCode(req: RequestWithTenantContext): string | undefined {
    const raw = (req.query as Record<string, unknown> | undefined)?.ref;
    return typeof raw === 'string' && raw.length > 0 ? raw : undefined;
  }

  /** Arma el bloque `design` desde el config del socio (misma forma). */
  private designFromConfig(config: Record<string, unknown>): DesignSnapshot {
    return {
      slides: config.slides ?? null,
      colors: config.colors ?? null,
      texts: config.texts ?? null,
      brand: config.brand ?? null,
    };
  }

  /** Deriva el bloque `branding` (espejo) desde el config del socio. */
  private brandingFromConfig(
    config: Record<string, unknown>,
  ): BrandingSnapshot {
    const brand = (config.brand ?? {}) as Record<string, unknown>;
    const colors = (config.colors ?? {}) as Record<string, unknown>;
    const str = (v: unknown): string | null =>
      typeof v === 'string' && v.length > 0 ? v : null;
    return {
      primaryColor: str(colors.accent),
      logoUrl: str(brand.logoUrl),
      faviconUrl: str(brand.faviconUrl),
      tagline: str(brand.tagline),
    };
  }
}
