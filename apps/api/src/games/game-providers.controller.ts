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
   * POST /tenant/game-providers/forever/activate-callback
   *
   * Copia el `game_provider.forever.agent_code` (tenant_settings) a
   * `tenants.forever_agent_code` (DB de control), que es lo que el callback
   * seamless de Forever usa para resolver el tenant. Sin esto, los juegos de
   * Forever no pueden leer el saldo del jugador. Idempotente.
   */
  @Post(':code/activate-callback')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('games.edit')
  async activateCallback(
    @Param('code') code: string,
    @Req() req: RequestWithTenantContext,
  ) {
    if (code !== 'forever') {
      throw new BadRequestException('Solo Forever usa este endpoint.');
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
    return this.service.runSync(req.tenantContext!.db, code);
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
