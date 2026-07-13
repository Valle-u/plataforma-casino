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
  Post,
  Req,
} from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { tenants } from '@casino/db';
import type { ControlDb } from '@casino/db';
import { CONTROL_DB } from '../../../common/symbols';
import { TenantConnectionCache } from '../../../tenant-resolver/tenant-connection-cache';
import {
  PALACE_RESULT,
  type PalaceCallbackRequest,
  type PalaceCallbackResponse,
  type PalaceCommand,
} from './palace.types';
import { PalaceCallbackService } from './palace-callback.service';

@Controller('api/v1/game-provider/palace')
export class PalaceCallbackController {
  private readonly logger = new Logger(PalaceCallbackController.name);

  constructor(
    @Inject(CONTROL_DB) private readonly controlDb: ControlDb,
    private readonly tenantCache: TenantConnectionCache,
    private readonly callbackService: PalaceCallbackService,
  ) {}

  @Post('callback')
  @HttpCode(200)
  async handleCallback(
    @Headers() headers: Record<string, string>,
    @Body() body: PalaceCallbackRequest,
    @Req() _req: unknown,
  ): Promise<PalaceCallbackResponse> {
    // 1. Validar Callback-Token
    const token = (headers['callback-token'] ?? '').trim();
    // Debug log: appendar a archivo temporal
    const fs = await import('fs/promises');
    await fs.appendFile('C:\\Users\\Admin\\AppData\\Local\\Temp\\opencode\\palace-callbacks.log', `[${new Date().toISOString()}] command=${body.command} data=${JSON.stringify(body.data ?? {})} check=${body.check} token=${token ? 'YES' : 'NO'}\n`).catch(() => {});
    this.logger.log(`[DEBUG] callback received: command=${body.command} data=${JSON.stringify(body.data ?? {})} check=${body.check}`);
    if (!token) {
      return {
        result: PALACE_RESULT.CALLBACK_TOKEN_INVALID,
        status: 'ERROR',
      };
    }

    // 2. Buscar el tenant con ese callback token en control DB
    const tenantRows = await this.controlDb
      .select()
      .from(tenants)
      .where(eq(tenants.palaceCallbackToken, token))
      .limit(1);

    const tenant = tenantRows[0];
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