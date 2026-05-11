/**
 * AuditLogController — endpoint para consultar la auditoría del tenant.
 *
 * Protegido por `audit.view`. No expone endpoints de mutación: el audit
 * log es append-only y se llena desde `AuditLogService.record()`, llamado
 * por los handlers de cada acción significativa.
 */

import {
  Controller,
  DefaultValuePipe,
  Get,
  ParseIntPipe,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { TenantJwtGuard } from '../tenant-auth/guards/tenant-jwt.guard';
import { PermissionsGuard } from '../permissions/permissions.guard';
import { RequirePermissions } from '../permissions/require-permissions.decorator';
import type { RequestWithTenantContext } from '../tenant-resolver/tenant-context';
import { AuditLogService } from './audit-log.service';

@Controller('tenant/audit-log')
@UseGuards(TenantJwtGuard, PermissionsGuard)
export class AuditLogController {
  constructor(private readonly audit: AuditLogService) {}

  /**
   * GET /tenant/audit-log
   * Filtros via query string:
   *   ?actorUserId=...
   *   ?actionCode=permissions.grant
   *   ?actionCodePrefix=permissions.   (cae con LIKE 'prefix%')
   *   ?targetId=...
   *   ?fromDate=2026-05-01T00:00:00Z
   *   ?toDate=...
   *   ?limit=50 (max 200)
   *   ?offset=0
   *   ?order=desc (default) | asc
   *
   * Requiere `audit.view`.
   */
  @Get()
  @RequirePermissions('audit.view')
  async list(
    @Req() req: RequestWithTenantContext,
    @Query('actorUserId') actorUserId?: string,
    @Query('actionCode') actionCode?: string,
    @Query('actionCodePrefix') actionCodePrefix?: string,
    @Query('targetId') targetId?: string,
    @Query('fromDate') fromDate?: string,
    @Query('toDate') toDate?: string,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit?: number,
    @Query('offset', new DefaultValuePipe(0), ParseIntPipe) offset?: number,
    @Query('order') order?: 'asc' | 'desc',
  ): Promise<{
    entries: unknown[];
    total: number;
    limit: number;
    offset: number;
  }> {
    const db = req.tenantContext!.db;
    const { entries, total } = await this.audit.query(db, {
      actorUserId,
      actionCode,
      actionCodePrefix,
      targetId,
      fromDate: fromDate ? new Date(fromDate) : undefined,
      toDate: toDate ? new Date(toDate) : undefined,
      limit,
      offset,
      order,
    });

    return {
      entries,
      total,
      limit: limit ?? 50,
      offset: offset ?? 0,
    };
  }
}
