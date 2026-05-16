/**
 * FraudController — panel admin antifraude.
 *
 * Endpoints (admin-only, todos requieren permission):
 *   GET    /tenant/fraud/stats         → KPIs (signals total, links por status)
 *   GET    /tenant/fraud/clusters      → clusters sospechosos (union-find live)
 *   GET    /tenant/fraud/links         → lista de links activos
 *   GET    /tenant/fraud/links/:id     → detalle de un link
 *   POST   /tenant/fraud/links/:id/confirm  → marcar duplicado real
 *   POST   /tenant/fraud/links/:id/dismiss  → descartar (false positive)
 *   POST   /tenant/fraud/scans/run     → dispara scan manual sobre el tenant
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
import { eq } from 'drizzle-orm';
import { users } from '@casino/db';
import { Logger as NestLogger } from '@nestjs/common';
import { AuditLogService } from '../audit/audit-log.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PermissionsGuard } from '../permissions/permissions.guard';
import { RequirePermissions } from '../permissions/require-permissions.decorator';
import { extractRequestContext } from '../request-context/request-context';
import { CurrentTenantUser } from '../tenant-auth/decorators/current-tenant-user.decorator';
import { TenantJwtGuard } from '../tenant-auth/guards/tenant-jwt.guard';
import type { RequestWithTenantContext } from '../tenant-resolver/tenant-context';
import { FraudDetectionService } from './fraud-detection.service';
import {
  FraudLinkAlreadyResolvedError,
  FraudLinkNotFoundError,
} from './fraud.errors';

@Controller('tenant/fraud')
@UseGuards(TenantJwtGuard, PermissionsGuard)
export class FraudController {
  private readonly logger = new NestLogger(FraudController.name);

  constructor(
    private readonly service: FraudDetectionService,
    private readonly audit: AuditLogService,
    private readonly notifications: NotificationsService,
  ) {}

  @Get('stats')
  @RequirePermissions('fraud.view')
  async stats(@Req() req: RequestWithTenantContext) {
    const db = req.tenantContext!.db;
    return this.service.stats(db);
  }

  @Get('clusters')
  @RequirePermissions('fraud.view')
  async clusters(@Req() req: RequestWithTenantContext) {
    const db = req.tenantContext!.db;
    const clusters = await this.service.getClusters(db);
    return { data: clusters, total: clusters.length };
  }

  /**
   * GET /tenant/fraud/links
   *
   * Lista paginada con LEFT JOIN a users (incluye username/displayName
   * de ambos lados del par). Filtros opcionales:
   *   ?status=suspected | confirmed | dismissed   (default: suspected+confirmed)
   *   ?userId=<uuid>                              (links donde aparece el user)
   *   ?minScore=<0-100>                           (override del threshold del tenant)
   *   ?limit=50&offset=0                          (paginación, max 200)
   */
  @Get('links')
  @RequirePermissions('fraud.view')
  async links(
    @Req() req: RequestWithTenantContext,
    @Query('status') status?: string,
    @Query('userId') userId?: string,
    @Query('minScore') minScore?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const db = req.tenantContext!.db;
    const validStatuses = ['suspected', 'confirmed', 'dismissed'] as const;
    if (status && !validStatuses.includes(status as (typeof validStatuses)[number])) {
      throw new BadRequestException({
        message: `Invalid status: ${status}. Allowed: ${validStatuses.join(', ')}.`,
        error: 'INVALID_FRAUD_STATUS',
      });
    }
    return this.service.listLinksForPanel(db, {
      status: status as 'suspected' | 'confirmed' | 'dismissed' | undefined,
      userId,
      minScore: minScore !== undefined ? Number(minScore) : undefined,
      limit: limit !== undefined ? Number(limit) : undefined,
      offset: offset !== undefined ? Number(offset) : undefined,
    });
  }

  @Get('links/:id')
  @RequirePermissions('fraud.view')
  async getLink(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: RequestWithTenantContext,
  ) {
    const db = req.tenantContext!.db;
    try {
      return await this.service.findLinkById(db, id);
    } catch (err) {
      if (err instanceof FraudLinkNotFoundError) {
        throw new NotFoundException({ message: err.message, error: 'FRAUD_LINK_NOT_FOUND' });
      }
      throw err;
    }
  }

  @Post('links/:id/confirm')
  @RequirePermissions('fraud.review')
  @HttpCode(HttpStatus.OK)
  async confirm(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: RequestWithTenantContext,
    @CurrentTenantUser() actor: { id: string; username: string },
  ) {
    const db = req.tenantContext!.db;
    let updated;
    try {
      updated = await this.service.confirmLink(db, id, actor.id);
    } catch (err) {
      throw this.mapError(err);
    }
    await this.audit.record(db, {
      actorUserId: actor.id,
      actorUsername: actor.username,
      actionCode: 'fraud.link.confirm',
      targetType: 'fraud_account_link',
      targetId: id,
      after: { status: 'confirmed', userAId: updated.userAId, userBId: updated.userBId },
      metadata: { severity: 'high', score: updated.score },
      ...extractRequestContext(req),
    });

    // Notif a admins del tenant (in_app + email): "nuevo link confirmado".
    // Excluimos al actor — quien confirma ya sabe lo que hizo. Lookup
    // usernames de userA/userB por separado para incluirlos en el
    // mensaje (legibles para humanos en lugar de UUIDs).
    try {
      const usernames = await db
        .select({ id: users.id, username: users.username })
        .from(users)
        .where(eq(users.id, updated.userAId));
      const usernamesB = await db
        .select({ id: users.id, username: users.username })
        .from(users)
        .where(eq(users.id, updated.userBId));
      const userAUsername = usernames[0]?.username ?? '?';
      const userBUsername = usernamesB[0]?.username ?? '?';
      for (const channel of ['in_app', 'email'] as const) {
        await this.notifications.enqueueForRole(db, {
          roleCode: 'admin_tenant',
          kind: 'fraud_cluster_confirmed',
          channel,
          payload: {
            linkId: id,
            score: Number(updated.score),
            userAUsername,
            userBUsername,
            confirmedByUsername: actor.username,
          },
          excludeUserId: actor.id,
        });
      }
    } catch (err) {
      this.logger.error(
        `Notif fraud_cluster_confirmed falló para link=${id}: ${(err as Error).message}`,
      );
    }

    return updated;
  }

  @Post('links/:id/dismiss')
  @RequirePermissions('fraud.review')
  @HttpCode(HttpStatus.OK)
  async dismiss(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: RequestWithTenantContext,
    @CurrentTenantUser() actor: { id: string; username: string },
  ) {
    const db = req.tenantContext!.db;
    let updated;
    try {
      updated = await this.service.dismissLink(db, id, actor.id);
    } catch (err) {
      throw this.mapError(err);
    }
    await this.audit.record(db, {
      actorUserId: actor.id,
      actorUsername: actor.username,
      actionCode: 'fraud.link.dismiss',
      targetType: 'fraud_account_link',
      targetId: id,
      after: { status: 'dismissed', userAId: updated.userAId, userBId: updated.userBId },
      metadata: { severity: 'medium' },
      ...extractRequestContext(req),
    });
    return updated;
  }

  /**
   * POST /tenant/fraud/scans/run
   * Corre el scan manualmente sobre el tenant del request. Útil para
   * testing + reconciliación cuando el cron diario no alcanza.
   */
  @Post('scans/run')
  @RequirePermissions('fraud.run_scan')
  @HttpCode(HttpStatus.OK)
  async runScan(
    @Req() req: RequestWithTenantContext,
    @CurrentTenantUser() actor: { id: string; username: string },
  ) {
    const db = req.tenantContext!.db;
    const result = await this.service.runScan(db);
    await this.audit.record(db, {
      actorUserId: actor.id,
      actorUsername: actor.username,
      actionCode: 'fraud.scan.manual',
      targetType: 'fraud_batch',
      targetId: null,
      metadata: { severity: 'medium', ...result },
      ...extractRequestContext(req),
    });
    return result;
  }

  private mapError(err: unknown): Error {
    if (err instanceof FraudLinkNotFoundError) {
      return new NotFoundException({ message: err.message, error: 'FRAUD_LINK_NOT_FOUND' });
    }
    if (err instanceof FraudLinkAlreadyResolvedError) {
      return new ConflictException({
        message: err.message,
        error: 'FRAUD_LINK_ALREADY_RESOLVED',
      });
    }
    return err as Error;
  }
}
