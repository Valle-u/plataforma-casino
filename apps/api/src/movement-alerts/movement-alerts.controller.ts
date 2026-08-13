/**
 * MovementAlertsController — panel de "Movimientos sospechosos" (fraude interno).
 *   GET  /tenant/movement-alerts          → lista (filtro status)
 *   GET  /tenant/movement-alerts/stats     → KPIs
 *   POST /tenant/movement-alerts/:id/confirm  → confirmar (es fraude)
 *   POST /tenant/movement-alerts/:id/dismiss  → descartar (falso positivo)
 *   POST /tenant/movement-alerts/scan/run     → correr análisis manual
 */

import {
  BadRequestException,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
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
import type {
  RequestWithTenantContext,
  TenantDb,
} from '../tenant-resolver/tenant-context';
import { ActorRoleService } from '../common/actor-role.service';
import { UserHierarchyService } from '../user-hierarchy/user-hierarchy.service';
import { MovementAlertsService } from './movement-alerts.service';

const STATUSES = ['suspected', 'confirmed', 'dismissed'] as const;
type AlertStatus = (typeof STATUSES)[number];

@Controller('tenant/movement-alerts')
@UseGuards(TenantJwtGuard, PermissionsGuard)
@PanelOnly()
export class MovementAlertsController {
  constructor(
    private readonly service: MovementAlertsService,
    private readonly audit: AuditLogService,
    private readonly actorRole: ActorRoleService,
    private readonly hierarchy: UserHierarchyService,
  ) {}

  /** Socio independiente ve solo actores de su sub-red; admin ve todo. */
  private async resolveScope(
    db: TenantDb,
    actorUserId: string,
  ): Promise<Set<string> | undefined> {
    const actor = await this.actorRole.classify(db, actorUserId);
    if (actor.kind !== 'independent_socio') return undefined;
    return this.hierarchy.getUserIdsInSubnetwork(db, actorUserId);
  }

  @Get('stats')
  @RequirePermissions('mov_alerts.view')
  async stats(
    @Req() req: RequestWithTenantContext,
    @CurrentTenantUser() actor: { id: string },
  ) {
    const db = req.tenantContext!.db;
    const scope = await this.resolveScope(db, actor.id);
    return this.service.stats(db, scope);
  }

  @Get()
  @RequirePermissions('mov_alerts.view')
  async list(
    @Req() req: RequestWithTenantContext,
    @CurrentTenantUser() actor: { id: string },
    @Query('status') status?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const db = req.tenantContext!.db;
    if (status && !STATUSES.includes(status as AlertStatus)) {
      throw new BadRequestException({
        message: `Estado inválido: ${status}`,
        error: 'INVALID_STATUS',
      });
    }
    const scope = await this.resolveScope(db, actor.id);
    return this.service.listAlerts(
      db,
      {
        status: status as AlertStatus | undefined,
        limit: Math.min(Math.max(Number(limit) || 25, 1), 100),
        offset: Math.max(Number(offset) || 0, 0),
      },
      scope,
    );
  }

  @Post(':id/confirm')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('mov_alerts.review')
  async confirm(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: RequestWithTenantContext,
    @CurrentTenantUser() actor: { id: string; username: string },
  ) {
    const db = req.tenantContext!.db;
    const scope = await this.resolveScope(db, actor.id);
    const res = await this.service.confirmAlert(db, id, actor.id, scope);
    if (res === null) throw new NotFoundException({ error: 'ALERT_NOT_FOUND' });
    if (res === 'already-resolved')
      throw new ConflictException({ error: 'ALERT_ALREADY_RESOLVED' });
    await this.audit.record(db, {
      actorUserId: actor.id,
      actorUsername: actor.username,
      actionCode: 'movement_alert.confirm',
      targetType: 'movement_alert',
      targetId: id,
      metadata: { severity: 'high', rule: res.rule },
      ...extractRequestContext(req),
    });
    return res;
  }

  @Post(':id/dismiss')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('mov_alerts.review')
  async dismiss(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: RequestWithTenantContext,
    @CurrentTenantUser() actor: { id: string; username: string },
  ) {
    const db = req.tenantContext!.db;
    const scope = await this.resolveScope(db, actor.id);
    const res = await this.service.dismissAlert(db, id, actor.id, scope);
    if (res === null) throw new NotFoundException({ error: 'ALERT_NOT_FOUND' });
    if (res === 'already-resolved')
      throw new ConflictException({ error: 'ALERT_ALREADY_RESOLVED' });
    await this.audit.record(db, {
      actorUserId: actor.id,
      actorUsername: actor.username,
      actionCode: 'movement_alert.dismiss',
      targetType: 'movement_alert',
      targetId: id,
      metadata: { severity: 'medium', rule: res.rule },
      ...extractRequestContext(req),
    });
    return res;
  }

  @Post('scan/run')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('mov_alerts.run')
  async runScan(
    @Req() req: RequestWithTenantContext,
    @CurrentTenantUser() actor: { id: string; username: string },
  ) {
    const db = req.tenantContext!.db;
    const result = await this.service.runScan(db);
    await this.audit.record(db, {
      actorUserId: actor.id,
      actorUsername: actor.username,
      actionCode: 'movement_alert.scan_run',
      targetType: 'movement_alert',
      targetId: 'scan',
      metadata: { ...result, severity: 'low' },
      ...extractRequestContext(req),
    });
    return result;
  }
}
