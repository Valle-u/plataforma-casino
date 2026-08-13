/**
 * UsersInactivityController — disparo MANUAL del barrido de inactividad.
 *
 * El cron corre a diario, pero el admin puede forzar el barrido (para probar
 * o para aplicar de una un cambio de `users.inactivity_days`). Solo panel,
 * gateado por `users.edit`. Auditado.
 */

import {
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuditLogService } from '../audit/audit-log.service';
import { PermissionsGuard } from '../permissions/permissions.guard';
import { RequirePermissions } from '../permissions/require-permissions.decorator';
import { extractRequestContext } from '../request-context/request-context';
import { CurrentTenantUser } from '../tenant-auth/decorators/current-tenant-user.decorator';
import { TenantJwtGuard } from '../tenant-auth/guards/tenant-jwt.guard';
import { PanelOnly } from '../tenant-auth/panel-only.decorator';
import type { RequestWithTenantContext } from '../tenant-resolver/tenant-context';
import { UsersInactivityService } from './users-inactivity.service';

@Controller('tenant/users-inactivity')
@UseGuards(TenantJwtGuard, PermissionsGuard)
@PanelOnly()
export class UsersInactivityController {
  constructor(
    private readonly service: UsersInactivityService,
    private readonly audit: AuditLogService,
  ) {}

  /**
   * POST /tenant/users-inactivity/run
   * Corre el barrido de inactividad ahora (mismo que el cron). Devuelve
   * cuántos jugadores se marcaron inactivos.
   */
  @Post('run')
  @RequirePermissions('users.edit')
  @HttpCode(HttpStatus.OK)
  async runNow(
    @Req() req: RequestWithTenantContext,
    @CurrentTenantUser() actor: { id: string; username: string },
  ): Promise<{ enabled: boolean; days: number; deactivated: number }> {
    const db = req.tenantContext!.db;
    const result = await this.service.runScan(db);
    await this.audit.record(db, {
      actorUserId: actor.id,
      actorUsername: actor.username,
      actionCode: 'users.deactivate_inactive.manual',
      targetType: 'user',
      targetId: null,
      metadata: { severity: 'medium', ...result },
      ...extractRequestContext(req),
    });
    return result;
  }
}
