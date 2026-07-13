/**
 * PalaceAdminController — endpoints admin para Palace Casino.
 *
 *   POST /tenant/games/palace/sync  → sincronizar catálogo.
 *
 * Requiere permiso `games.edit`.
 */

import {
  Controller,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { RequirePermissions } from '../../../permissions/require-permissions.decorator';
import { PermissionsGuard } from '../../../permissions/permissions.guard';
import { TenantJwtGuard } from '../../../tenant-auth/guards/tenant-jwt.guard';
import { PanelOnly } from '../../../tenant-auth/panel-only.decorator';
import type { RequestWithTenantContext } from '../../../tenant-resolver/tenant-context';
import { PalaceSyncService } from './palace-sync.service';

@Controller('tenant/games/palace')
@UseGuards(TenantJwtGuard, PermissionsGuard)
@PanelOnly()
export class PalaceAdminController {
  private readonly logger = new Logger(PalaceAdminController.name);

  constructor(private readonly syncService: PalaceSyncService) {}

  @Post('sync')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('games.edit')
  async syncCatalog(@Req() req: RequestWithTenantContext) {
    const db = req.tenantContext!.db;
    const result = await this.syncService.syncGames(db);
    this.logger.log(
      `Sync Palace: ${result.fetched} traídos, ${result.created} nuevos, ${result.updated} actualizados, ${result.deactivated} desactivados`,
    );
    return result;
  }
}