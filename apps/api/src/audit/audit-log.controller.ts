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
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import {
  buildCsv,
  buildCsvFilename,
  CSV_EXPORT_MAX_ROWS,
  type CsvColumn,
} from '../common/csv';
import { CurrentTenantUser } from '../tenant-auth/decorators/current-tenant-user.decorator';
import { TenantJwtGuard } from '../tenant-auth/guards/tenant-jwt.guard';
import { PermissionsGuard } from '../permissions/permissions.guard';
import { RequirePermissions } from '../permissions/require-permissions.decorator';
import { extractRequestContext } from '../request-context/request-context';
import type { RequestWithTenantContext } from '../tenant-resolver/tenant-context';
import { AuditLogService } from './audit-log.service';
import type { AuditLogEntry } from '@casino/db';

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

  /**
   * GET /tenant/audit-log/export
   * Export CSV con los mismos filtros que `GET /tenant/audit-log`, sin
   * paginación. Cap en `CSV_EXPORT_MAX_ROWS` (50k) — más que eso debería
   * ir por job async (post-MVP).
   *
   * Records audit entry `audit.export` con metadata { rowCount, filters,
   * truncated }. Severity 'medium' — saber qué admin descargó qué data
   * es importante para forensics.
   *
   * Requiere `audit.export` (NO delegable — el seed lo otorga sólo a
   * admin_tenant; otros roles necesitan override explícito).
   */
  @Get('export')
  @RequirePermissions('audit.export')
  async exportCsv(
    @Req() req: RequestWithTenantContext,
    @Res() res: Response,
    @CurrentTenantUser() actor: { id: string; username: string },
    @Query('actorUserId') actorUserId?: string,
    @Query('actionCode') actionCode?: string,
    @Query('actionCodePrefix') actionCodePrefix?: string,
    @Query('targetId') targetId?: string,
    @Query('fromDate') fromDate?: string,
    @Query('toDate') toDate?: string,
    @Query('order') order?: 'asc' | 'desc',
  ): Promise<void> {
    const db = req.tenantContext!.db;

    const { entries, total } = await this.audit.query(db, {
      actorUserId,
      actionCode,
      actionCodePrefix,
      targetId,
      fromDate: fromDate ? new Date(fromDate) : undefined,
      toDate: toDate ? new Date(toDate) : undefined,
      limit: CSV_EXPORT_MAX_ROWS,
      offset: 0,
      order: order ?? 'desc',
    });

    const truncated = total > entries.length;

    const csv = buildCsv<AuditLogEntry>(AUDIT_CSV_COLUMNS, entries);

    const filters = {
      actorUserId: actorUserId ?? null,
      actionCode: actionCode ?? null,
      actionCodePrefix: actionCodePrefix ?? null,
      targetId: targetId ?? null,
      fromDate: fromDate ?? null,
      toDate: toDate ?? null,
      order: order ?? 'desc',
    };

    await this.audit.record(db, {
      actorUserId: actor.id,
      actorUsername: actor.username,
      actionCode: 'audit.export',
      targetType: 'audit_log',
      targetId: null,
      metadata: {
        rowCount: entries.length,
        totalMatched: total,
        truncated,
        filters,
        severity: 'medium',
      },
      ...extractRequestContext(req),
    });

    const filename = buildCsvFilename('audit_log');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('X-Total-Rows', String(entries.length));
    if (truncated) res.setHeader('X-Truncated', 'true');
    res.send(csv);
  }
}

// ──────────────────────────────────────────────────────────────────────
// CSV column definitions
// ──────────────────────────────────────────────────────────────────────

const AUDIT_CSV_COLUMNS: CsvColumn<AuditLogEntry>[] = [
  { header: 'created_at', value: (r) => r.createdAt },
  { header: 'id', value: (r) => r.id },
  { header: 'action_code', value: (r) => r.actionCode },
  { header: 'actor_user_id', value: (r) => r.actorUserId },
  { header: 'actor_username', value: (r) => r.actorUsername },
  { header: 'actor_role_at_time', value: (r) => r.actorRoleAtTime },
  { header: 'target_type', value: (r) => r.targetType },
  { header: 'target_id', value: (r) => r.targetId },
  { header: 'reason', value: (r) => r.reason },
  { header: 'before', value: (r) => r.before },
  { header: 'after', value: (r) => r.after },
  { header: 'metadata', value: (r) => r.metadata },
  { header: 'ip', value: (r) => r.ip },
  { header: 'user_agent', value: (r) => r.userAgent },
  { header: 'request_id', value: (r) => r.requestId },
  { header: 'session_id', value: (r) => r.sessionId },
  { header: 'impersonator_id', value: (r) => r.impersonatorId },
];
