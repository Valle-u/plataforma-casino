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
import type { RequestWithTenantContext } from '../tenant-resolver/tenant-context';
import { NotificationsService } from './notifications.service';

@Controller('tenant/notifications')
@UseGuards(TenantJwtGuard)
export class NotificationsController {
  constructor(private readonly service: NotificationsService) {}

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
