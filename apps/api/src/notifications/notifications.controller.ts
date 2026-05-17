/**
 * NotificationsController — endpoints user-facing.
 *
 * Endpoints:
 *   GET    /tenant/notifications/me                  → mis notifs (paginado)
 *   GET    /tenant/notifications/me/unread-count     → badge UI
 *   POST   /tenant/notifications/me/:id/read         → marcar una read
 *   POST   /tenant/notifications/me/read-all         → marcar todas read
 *
 * Todos requieren TenantJwtGuard (user logueado). NO requieren permiso
 * adicional — un user puede ver/marcar SUS notifs sin role especial.
 *
 * Endpoint admin de disparo manual del dispatcher (futuro):
 *   POST  /tenant/notifications/dispatch (permission notifications.admin)
 *   — útil para reconciliar manualmente. Hoy no se incluye para no
 *     exponer superficie sin uso real; sumar cuando el frontend lo pida.
 */

import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { CurrentTenantUser } from '../tenant-auth/decorators/current-tenant-user.decorator';
import { TenantJwtGuard } from '../tenant-auth/guards/tenant-jwt.guard';
import { PermissionsGuard } from '../permissions/permissions.guard';
import { RequirePermissions } from '../permissions/require-permissions.decorator';
import type { RequestWithTenantContext } from '../tenant-resolver/tenant-context';
import { NotificationsService } from './notifications.service';

@Controller('tenant/notifications')
@UseGuards(TenantJwtGuard, PermissionsGuard)
export class NotificationsController {
  constructor(private readonly service: NotificationsService) {}

  /**
   * GET /tenant/notifications
   *
   * Admin queue: lista notifs de TODOS los users con filtros server-side.
   * Requiere `notifications.view_any` (admin / soporte ven actividad outbound
   * del tenant para diagnosticar entregas).
   *
   * Filtros (CSV en query params):
   *   - ?statuses=pending,failed
   *   - ?channels=email,sms
   *   - ?kind=fraud_cluster_detected
   *   - ?userId=<uuid>
   *   - ?fromDate=ISO&toDate=ISO
   *   - ?limit=50&offset=0 (default 50, max 200)
   */
  @Get()
  @RequirePermissions('notifications.view_any')
  async listAll(
    @Req() req: RequestWithTenantContext,
    @Query('statuses') statuses?: string,
    @Query('channels') channels?: string,
    @Query('kind') kind?: string,
    @Query('userId') userId?: string,
    @Query('fromDate') fromDate?: string,
    @Query('toDate') toDate?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const db = req.tenantContext!.db;
    return this.service.listAll(db, {
      statuses: statuses
        ? (statuses.split(',').map((s) => s.trim()) as Array<
            'pending' | 'sent' | 'failed' | 'read'
          >)
        : undefined,
      channels: channels
        ? (channels.split(',').map((s) => s.trim()) as Array<
            'in_app' | 'email' | 'sms'
          >)
        : undefined,
      kind,
      userId,
      fromDate: fromDate ? new Date(fromDate) : undefined,
      toDate: toDate ? new Date(toDate) : undefined,
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
    });
  }

  @Get('me')
  async listMine(
    @Req() req: RequestWithTenantContext,
    @CurrentTenantUser() actor: { id: string },
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
    @Query('onlyUnread') onlyUnread?: string,
  ) {
    const db = req.tenantContext!.db;
    const data = await this.service.listForUser(db, actor.id, {
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
      onlyUnread: onlyUnread === 'true',
    });
    return { data };
  }

  @Get('me/unread-count')
  async unreadCount(
    @Req() req: RequestWithTenantContext,
    @CurrentTenantUser() actor: { id: string },
  ) {
    const db = req.tenantContext!.db;
    const count = await this.service.countUnreadForUser(db, actor.id);
    return { count };
  }

  @Post('me/:id/read')
  @HttpCode(HttpStatus.OK)
  async markRead(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: RequestWithTenantContext,
    @CurrentTenantUser() actor: { id: string },
  ) {
    const db = req.tenantContext!.db;
    const updated = await this.service.markAsRead(db, id, actor.id);
    return updated;
  }

  @Post('me/read-all')
  @HttpCode(HttpStatus.OK)
  async markAllRead(
    @Req() req: RequestWithTenantContext,
    @CurrentTenantUser() actor: { id: string },
  ) {
    const db = req.tenantContext!.db;
    const updated = await this.service.markAllAsReadForUser(db, actor.id);
    return { updated };
  }
}
