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
import { eq, isNotNull, and } from 'drizzle-orm';
import { tenants } from '@casino/db';
import type { ControlDb, Tenant } from '@casino/db';
import { CONTROL_DB } from '../../../common/symbols';
import { TenantConnectionCache } from '../../../tenant-resolver/tenant-connection-cache';
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
  ) {}

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
    } catch (err) {
      this.logger.warn(`Failed to pre-load palace tokens: ${(err as Error).message}`);
    }
  }

  @Post('callback')
  @HttpCode(200)
  async handleCallback(
    @Headers() headers: Record<string, string>,
    @Body() body: PalaceCallbackRequest,
    @Req() _req: unknown,
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