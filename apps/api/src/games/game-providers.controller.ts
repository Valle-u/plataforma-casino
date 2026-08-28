/**
 * GameProvidersController — panel "Game Providers" (config + estado + salud).
 *
 *   GET   /tenant/game-providers            → lista con estado + config.
 *   GET   /tenant/game-providers/:code      → uno.
 *   PATCH /tenant/game-providers/:code      → flags (habilitado / mantenimiento).
 *   POST  /tenant/game-providers/:code/test → probar conexión (ping).
 *   POST  /tenant/game-providers/:code/diagnose → diagnóstico pass/fail.
 *   POST  /tenant/game-providers/:code/sync → sync manual del catálogo.
 *
 * Requiere `games.edit` (admin). Las credenciales se cargan por
 * `PATCH /tenant/settings/:key` (validadas por el registry), no acá.
 */

import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { tenants, type ControlDb } from '@casino/db';
import { CONTROL_DB } from '../common/symbols';
import { isUniqueViolation } from '../common/pg-error';
import { RequirePermissions } from '../permissions/require-permissions.decorator';
import { PermissionsGuard } from '../permissions/permissions.guard';
import { TenantJwtGuard } from '../tenant-auth/guards/tenant-jwt.guard';
import { PanelOnly } from '../tenant-auth/panel-only.decorator';
import { TenantSettingsService } from '../tenant-settings/tenant-settings.service';
import type { RequestWithTenantContext } from '../tenant-resolver/tenant-context';
import { UpdateGameProviderDto } from './dto/update-game-provider.dto';
import { GameProvidersService } from './game-providers.service';
import {
  GameProviderLogsService,
  type LogSeverity,
} from './game-provider-logs.service';

@Controller('tenant/game-providers')
@UseGuards(TenantJwtGuard, PermissionsGuard)
@PanelOnly()
export class GameProvidersController {
  constructor(
    private readonly service: GameProvidersService,
    private readonly logs: GameProviderLogsService,
    @Inject(CONTROL_DB) private readonly controlDb: ControlDb,
    private readonly settings: TenantSettingsService,
  ) {}

  /**
   * POST /tenant/game-providers/:code/activate-callback
   *
   * Registra en la DB de CONTROL el dato con el que el callback seamless
   * resuelve a qué tenant pertenece. Cada proveedor usa el suyo:
   *
   *   - `forever`  → copia el `agent_code` de tenant_settings a
   *                  `tenants.forever_agent_code` (Forever lo manda en un header).
   *   - `gregmorn` → GENERA un token opaco, lo guarda en
   *                  `tenants.gregmorn_callback_token` y arma la callback URL
   *                  que lo lleva adentro (Gregmorn no manda nada del que se
   *                  pueda deducir el tenant, así que viaja en la URL).
   *
   * Sin esto, los juegos del proveedor no pueden leer ni mover el saldo del
   * jugador. Idempotente en los dos casos.
   */
  @Post(':code/activate-callback')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('games.edit')
  async activateCallback(
    @Param('code') code: string,
    @Req() req: RequestWithTenantContext,
  ) {
    if (code === 'gregmorn') {
      return this.activateGregmornCallback(req);
    }
    if (code !== 'forever') {
      throw new BadRequestException('Ese proveedor no usa este endpoint.');
    }
    const agentCode = (
      await this.settings.get<string>(
        req.tenantContext!.db,
        'game_provider.forever.agent_code',
      )
    )?.trim();
    if (!agentCode) {
      throw new BadRequestException(
        'Cargá primero el Agent code en las credenciales de Forever y guardá.',
      );
    }
    const tenantId = req.tenantContext!.tenant.id;
    try {
      await this.controlDb
        .update(tenants)
        .set({ foreverAgentCode: agentCode })
        .where(eq(tenants.id, tenantId));
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictException(
          'Ese agent code ya está en uso por otro tenant.',
        );
      }
      throw err;
    }
    return { ok: true, agentCode };
  }

  /**
   * Activación de Gregmorn: token opaco + callback URL que lo lleva adentro.
   *
   * El token se genera acá y **no se reemplaza si ya existe**: rotarlo dejaría
   * ciegos a los juegos que estén abiertos en ese momento (sus callbacks
   * apuntarían a una URL que ya no resuelve ningún tenant).
   *
   * La base de la URL sale del propio request — el panel le pega a la misma API
   * que va a recibir los callbacks. Se respetan los headers `x-forwarded-*`
   * porque la API vive detrás del proxy de Cloudflare.
   */
  private async activateGregmornCallback(req: RequestWithTenantContext) {
    const tenantId = req.tenantContext!.tenant.id;

    const [row] = await this.controlDb
      .select({ token: tenants.gregmornCallbackToken })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1);

    let token = row?.token?.trim() ?? '';
    if (!token) {
      token = randomBytes(24).toString('hex');
      try {
        await this.controlDb
          .update(tenants)
          .set({ gregmornCallbackToken: token })
          .where(eq(tenants.id, tenantId));
      } catch (err) {
        if (isUniqueViolation(err)) {
          throw new ConflictException(
            'Colisión al generar el token de callback. Probá de nuevo.',
          );
        }
        throw err;
      }
    }

    const callbackUrl = `${this.publicApiBaseUrl(req)}/api/v1/game-provider/gregmorn/callback/${token}`;

    // Se guarda como setting porque es lo que el launch manda en cada openGame.
    await this.settings.set(
      req.tenantContext!.db,
      'game_provider.gregmorn.callback_url',
      callbackUrl,
      null,
    );

    return { ok: true, callbackUrl };
  }

  /** Origen público de la API, respetando el proxy (Cloudflare). */
  private publicApiBaseUrl(req: RequestWithTenantContext): string {
    const headers = (req.headers ?? {}) as Record<string, string | string[] | undefined>;
    const first = (v: string | string[] | undefined): string =>
      (Array.isArray(v) ? v[0] : v)?.split(',')[0]?.trim() ?? '';

    const proto = first(headers['x-forwarded-proto']) || 'https';
    const host = first(headers['x-forwarded-host']) || first(headers.host);
    if (!host) {
      throw new BadRequestException(
        'No se pudo determinar el host público de la API para armar la callback URL.',
      );
    }
    return `${proto}://${host}`;
  }

  @Get()
  @RequirePermissions('games.edit')
  async list(@Req() req: RequestWithTenantContext) {
    return this.service.list(req.tenantContext!.db);
  }

  @Get(':code')
  @RequirePermissions('games.edit')
  async getOne(
    @Param('code') code: string,
    @Req() req: RequestWithTenantContext,
  ) {
    return this.service.getOne(req.tenantContext!.db, code);
  }

  @Patch(':code')
  @RequirePermissions('games.edit')
  async update(
    @Param('code') code: string,
    @Body() dto: UpdateGameProviderDto,
    @Req() req: RequestWithTenantContext,
  ) {
    return this.service.updateFlags(req.tenantContext!.db, code, dto);
  }

  @Post(':code/test')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('games.edit')
  async test(
    @Param('code') code: string,
    @Req() req: RequestWithTenantContext,
  ) {
    return this.service.testConnection(req.tenantContext!.db, code);
  }

  @Post(':code/diagnose')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('games.edit')
  async diagnose(
    @Param('code') code: string,
    @Req() req: RequestWithTenantContext,
  ) {
    return this.service.diagnose(req.tenantContext!.db, code);
  }

  @Post(':code/sync')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('games.edit')
  async sync(
    @Param('code') code: string,
    @Req() req: RequestWithTenantContext,
  ) {
    // Sync en segundo plano: devuelve enseguida (el catálogo puede tardar minutos
    // y no entra en el timeout del gateway → 502). El estado se ve en "Última
    // sincronización" cuando termina.
    return this.service.startSync(req.tenantContext!.db, code);
  }

  /** GET /tenant/game-providers/:code/logs — logs/diagnóstico paginados. */
  @Get(':code/logs')
  @RequirePermissions('games.edit')
  async listLogs(
    @Param('code') code: string,
    @Req() req: RequestWithTenantContext,
    @Query('eventType') eventType?: string,
    @Query('severity') severity?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.logs.list(req.tenantContext!.db, {
      providerCode: code,
      eventType: eventType || undefined,
      severity: (severity as LogSeverity) || undefined,
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
    });
  }
}
