/**
 * PalaceCallbackController — endpoint que Palace llama.
 *
 * Ruta: POST /api/v1/game-provider/palace/callback
 *
 * Este endpoint está FUERA del flujo normal del TenantResolver porque
 * Palace no manda un header de Host/tenant. El tenant se resuelve
 * buscando el `palace_callback_token` en la DB de control.
 *
 * Flujo:
 *   1. Lee el header `Callback-Token`.
 *   2. Busca en control DB el tenant con ese token.
 *   3. Obtiene la conexión a la DB del tenant desde el cache.
 *   4. Parsea el body (command, data, check).
 *   5. Pasa al PalaceCallbackService para procesar.
 *   6. Devuelve el response JSON.
 *
 * Timeouts críticos del proveedor:
 *   - bet/balance → ≤ 2 segundos.
 *   - demás commands → ≤ 4 segundos.
 */

import {
  Body,
  Controller,
  Headers,
  HttpCode,
  Logger,
  OnModuleInit,
  Post,
  Req,
} from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { eq, isNotNull, and } from 'drizzle-orm';
import { tenants } from '@casino/db';
import type { ControlDb, Tenant } from '@casino/db';
import { sql } from 'drizzle-orm';
import { CONTROL_DB } from '../../../common/symbols';
import { TenantConnectionCache } from '../../../tenant-resolver/tenant-connection-cache';
import { TenantSettingsService } from '../../../tenant-settings/tenant-settings.service';
import {
  PALACE_RESULT,
  type PalaceCallbackRequest,
  type PalaceCallbackResponse,
  type PalaceCommand,
} from './palace.types';
import { PalaceCallbackService } from './palace-callback.service';

type TenantRow = Tenant;

/** In-memory cache for token → tenant resolution. Long TTL — only invalidated by restart. */
const tokenCache = new Map<string, TenantRow>();

@Controller('api/v1/game-provider/palace')
export class PalaceCallbackController implements OnModuleInit {
  private readonly logger = new Logger(PalaceCallbackController.name);

  constructor(
    @Inject(CONTROL_DB) private readonly controlDb: ControlDb,
    private readonly tenantCache: TenantConnectionCache,
    private readonly callbackService: PalaceCallbackService,
    private readonly settings: TenantSettingsService,
  ) {}

  /**
   * Cache de la config de IPs por tenant (TTL corto) para no leer settings en
   * cada callback (bet/balance tienen presupuesto ≤2s). Se refresca solo.
   */
  private readonly ipConfigCache = new Map<
    string,
    { mode: string; allowlist: string[]; expiresAt: number }
  >();

  /**
   * Endurecimiento del callback (auditoría económica #1): allowlist de IPs.
   * Palace llama desde IPs conocidas; un token filtrado no sirve desde otro
   * origen. Arranca en modo "observe" (solo registra la IP; NO bloquea) para
   * no cortar el servicio — el operador mira los logs, confirma las IPs de
   * Palace, las carga en `game_provider.palace.callback_ip_allowlist`, y flipea
   * `game_provider.palace.callback_ip_mode` a "enforce". Provider-agnóstico por
   * naming: un proveedor futuro usa sus propias keys `game_provider.<code>.*`.
   *
   * Devuelve `true` si se permite procesar; `false` si (enforce) la IP no está
   * en la allowlist.
   */
  private async isCallbackIpAllowed(
    tenant: TenantRow,
    tenantDb: ReturnType<TenantConnectionCache['get']>,
    clientIp: string,
  ): Promise<boolean> {
    let cfg = this.ipConfigCache.get(tenant.id);
    const now = Date.now();
    if (!cfg || cfg.expiresAt < now) {
      const mode =
        (await this.settings.get<string>(
          tenantDb,
          'game_provider.palace.callback_ip_mode',
        )) ?? 'observe';
      const allowlist =
        (await this.settings.get<string[]>(
          tenantDb,
          'game_provider.palace.callback_ip_allowlist',
        )) ?? [];
      cfg = {
        mode,
        allowlist: Array.isArray(allowlist) ? allowlist : [],
        expiresAt: now + 60_000,
      };
      this.ipConfigCache.set(tenant.id, cfg);
    }

    const inList = cfg.allowlist.includes(clientIp);
    if (cfg.mode === 'enforce' && cfg.allowlist.length > 0 && !inList) {
      this.logger.warn(
        `[callback-ip ENFORCE] BLOQUEADO ip=${clientIp} tenant=${tenant.slug} (no está en la allowlist)`,
      );
      return false;
    }
    // Modo observe (o enforce con allowlist vacía / IP permitida): registra.
    this.logger.log(
      `[callback-ip ${cfg.mode}] ip=${clientIp} tenant=${tenant.slug} allowed=${
        cfg.allowlist.length === 0 ? 'n/a' : inList
      }`,
    );
    return true;
  }

  async onModuleInit(): Promise<void> {
    // Pre-load all active tenants with palace_callback_token into memory.
    // This eliminates the cross-region DB round-trip on every Palace callback.
    try {
      const rows = await this.controlDb
        .select()
        .from(tenants)
        .where(and(eq(tenants.status, 'active'), isNotNull(tenants.palaceCallbackToken)));
      for (const row of rows) {
        if (row.palaceCallbackToken) {
          tokenCache.set(row.palaceCallbackToken, row);
        }
      }
      this.logger.log(`Pre-loaded ${rows.length} palace callback token(s) into memory`);

      // Warm up tenant DB connections so the first Palace callback isn't slow.
      for (const row of rows) {
        try {
          const tenantDb = this.tenantCache.get(row);
          await tenantDb.execute(sql`SELECT 1`);
          this.logger.log(`Warmed up tenant DB connection: ${row.dbName}`);
        } catch (err) {
          this.logger.warn(`Failed to warm tenant DB ${row.dbName}: ${(err as Error).message}`);
        }
      }
    } catch (err) {
      this.logger.warn(`Failed to pre-load palace tokens: ${(err as Error).message}`);
    }
  }

  @Cron('0 */3 * * *')
  async keepAliveTenantDbs(): Promise<void> {
    for (const [, tenant] of tokenCache) {
      try {
        const tenantDb = this.tenantCache.get(tenant);
        await tenantDb.execute(sql`SELECT 1`);
      } catch {
        // silently ignore — just keeping connections warm
      }
    }
  }

  @Post('callback')
  @HttpCode(200)
  async handleCallback(
    @Headers() headers: Record<string, string>,
    @Body() body: PalaceCallbackRequest,
    @Req() req: { ip?: string; socket?: { remoteAddress?: string } },
  ): Promise<PalaceCallbackResponse> {
    // 1. Validar Callback-Token
    const token = (headers['callback-token'] ?? '').trim();
    this.logger.log(`callback received: command=${body.command} check=${body.check}`);
    if (!token) {
      return {
        result: PALACE_RESULT.CALLBACK_TOKEN_INVALID,
        status: 'ERROR',
      };
    }

    // 2. Buscar el tenant con ese callback token (pre-loaded at startup)
    let tenant = tokenCache.get(token);

    if (!tenant) {
      // Fallback: query control DB if token not in cache (e.g., new tenant added at runtime)
      const tenantRows = await this.controlDb
        .select()
        .from(tenants)
        .where(eq(tenants.palaceCallbackToken, token))
        .limit(1);
      tenant = tenantRows[0];
      if (tenant && tenant.status === 'active') {
        tokenCache.set(token, tenant);
      }
    }

    if (!tenant || tenant.status !== 'active') {
      this.logger.warn(`Callback token no matchea ningún tenant activo`);
      return {
        result: PALACE_RESULT.CALLBACK_TOKEN_INVALID,
        status: 'ERROR',
      };
    }

    // 3. Obtener conexión a la DB del tenant
    const tenantDb = this.tenantCache.get(tenant);

    // 3b. Endurecimiento (auditoría económica #1): allowlist de IPs. Por
    //     default en modo "observe" → solo registra la IP, NO bloquea.
    const xff = (headers['x-forwarded-for'] ?? '').toString();
    const clientIp =
      xff.split(',')[0]?.trim() ||
      req.ip ||
      req.socket?.remoteAddress ||
      'unknown';
    if (!(await this.isCallbackIpAllowed(tenant, tenantDb, clientIp))) {
      return {
        result: PALACE_RESULT.CALLBACK_TOKEN_INVALID,
        status: 'ERROR',
      };
    }

    // 4. Parsear checks
    const checks = body.check
      ? body.check
          .split(',')
          .map((c) => Number.parseInt(c.trim(), 10))
          .filter((n) => Number.isFinite(n))
      : [];

    // 5. Procesar
    const command = body.command as PalaceCommand;
    const data = body.data ?? {};

    return this.callbackService.handle(tenantDb, command, data, checks);
  }
}