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
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { AuditLogService } from '../audit/audit-log.service';
import {
  buildCsv,
  buildCsvFilename,
  CSV_EXPORT_MAX_ROWS,
  type CsvColumn,
} from '../common/csv';
import { extractRequestContext } from '../request-context/request-context';
import { CurrentTenantUser } from '../tenant-auth/decorators/current-tenant-user.decorator';
import { TenantJwtGuard } from '../tenant-auth/guards/tenant-jwt.guard';
import { PermissionsGuard } from '../permissions/permissions.guard';
import { RequirePermissions } from '../permissions/require-permissions.decorator';
import type { RequestWithTenantContext } from '../tenant-resolver/tenant-context';
import {
  NotificationsService,
  type NotificationWithUser,
} from './notifications.service';

@Controller('tenant/notifications')
@UseGuards(TenantJwtGuard, PermissionsGuard)
export class NotificationsController {
  constructor(
    private readonly service: NotificationsService,
    private readonly audit: AuditLogService,
  ) {}

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

  /**
   * GET /tenant/notifications/export
   * Export CSV de notifications con los mismos filtros que listAll.
   * Records audit `notifications.export`. Permission `notifications.export`.
   */
  @Get('export')
  @RequirePermissions('notifications.export')
  async exportCsv(
    @Req() req: RequestWithTenantContext,
    @Res() res: Response,
    @CurrentTenantUser() actor: { id: string; username: string },
    @Query('statuses') statuses?: string,
    @Query('channels') channels?: string,
    @Query('kind') kind?: string,
    @Query('userId') userId?: string,
    @Query('fromDate') fromDate?: string,
    @Query('toDate') toDate?: string,
  ): Promise<void> {
    const db = req.tenantContext!.db;
    const filters = {
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
      limit: CSV_EXPORT_MAX_ROWS,
      offset: 0,
    };
    const { data, total } = await this.service.listAll(db, filters);

    await this.audit.record(db, {
      actorUserId: actor.id,
      actorUsername: actor.username,
      actionCode: 'notifications.export',
      targetType: 'notification',
      targetId: null,
      metadata: {
        rowCount: data.length,
        totalMatched: total,
        truncated: total > data.length,
        filters: {
          statuses: statuses ?? null,
          channels: channels ?? null,
          kind: kind ?? null,
          userId: userId ?? null,
          fromDate: fromDate ?? null,
          toDate: toDate ?? null,
        },
        severity: 'medium',
      },
      ...extractRequestContext(req),
    });

    const csv = buildCsv<NotificationWithUser>(NOTIFICATION_CSV_COLUMNS, data);
    const filename = buildCsvFilename('notifications');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('X-Total-Rows', String(data.length));
    if (total > data.length) res.setHeader('X-Truncated', 'true');
    res.send(csv);
  }

  /**
   * POST /tenant/notifications/:id/retry
   * Re-encola una notification failed. El service valida que el status
   * actual sea 'failed' (sino 404 con error 'NOTIFICATION_NOT_RETRIABLE').
   * Records audit `notifications.retry` con `before.status='failed'`.
   * Permission `notifications.retry`.
   */
  @Post(':id/retry')
  @RequirePermissions('notifications.retry')
  @HttpCode(HttpStatus.OK)
  async retry(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: RequestWithTenantContext,
    @CurrentTenantUser() actor: { id: string; username: string },
  ) {
    const db = req.tenantContext!.db;
    const updated = await this.service.markForRetry(db, id);
    await this.audit.record(db, {
      actorUserId: actor.id,
      actorUsername: actor.username,
      actionCode: 'notifications.retry',
      targetType: 'notification',
      targetId: id,
      before: { status: 'failed' },
      after: { status: updated.status },
      metadata: {
        kind: updated.kind,
        channel: updated.channel,
        severity: 'medium',
      },
      ...extractRequestContext(req),
    });
    return updated;
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

// ──────────────────────────────────────────────────────────────────────
// CSV column definitions
// ──────────────────────────────────────────────────────────────────────

const NOTIFICATION_CSV_COLUMNS: CsvColumn<NotificationWithUser>[] = [
  { header: 'created_at', value: (r) => r.createdAt },
  { header: 'id', value: (r) => r.id },
  { header: 'user_id', value: (r) => r.userId },
  { header: 'username', value: (r) => r.userUsername },
  { header: 'display_name', value: (r) => r.userDisplayName },
  { header: 'kind', value: (r) => r.kind },
  { header: 'channel', value: (r) => r.channel },
  { header: 'status', value: (r) => r.status },
  { header: 'subject', value: (r) => r.subject },
  { header: 'body', value: (r) => r.body },
  { header: 'payload', value: (r) => r.payload },
  { header: 'error', value: (r) => r.error },
  { header: 'sent_at', value: (r) => r.sentAt },
  { header: 'read_at', value: (r) => r.readAt },
];
