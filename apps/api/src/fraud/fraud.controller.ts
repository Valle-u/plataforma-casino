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
  ConflictException,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  ParseUUIDPipe,
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
import type { RequestWithTenantContext } from '../tenant-resolver/tenant-context';
import { FraudDetectionService } from './fraud-detection.service';
import {
  FraudLinkAlreadyResolvedError,
  FraudLinkNotFoundError,
} from './fraud.errors';

@Controller('tenant/fraud')
@UseGuards(TenantJwtGuard, PermissionsGuard)
export class FraudController {
  constructor(
    private readonly service: FraudDetectionService,
    private readonly audit: AuditLogService,
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

  @Get('links')
  @RequirePermissions('fraud.view')
  async links(@Req() req: RequestWithTenantContext) {
    const db = req.tenantContext!.db;
    const data = await this.service.listActiveLinks(db);
    return { data };
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
