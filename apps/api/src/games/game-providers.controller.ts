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
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { RequirePermissions } from '../permissions/require-permissions.decorator';
import { PermissionsGuard } from '../permissions/permissions.guard';
import { TenantJwtGuard } from '../tenant-auth/guards/tenant-jwt.guard';
import { PanelOnly } from '../tenant-auth/panel-only.decorator';
import type { RequestWithTenantContext } from '../tenant-resolver/tenant-context';
import { UpdateGameProviderDto } from './dto/update-game-provider.dto';
import { GameProvidersService } from './game-providers.service';

@Controller('tenant/game-providers')
@UseGuards(TenantJwtGuard, PermissionsGuard)
@PanelOnly()
export class GameProvidersController {
  constructor(private readonly service: GameProvidersService) {}

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
}
