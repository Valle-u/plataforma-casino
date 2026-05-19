/**
 * BonusDefinitionsController — CRUD de plantillas de bono.
 *
 * Endpoints (todos JWT-protected + permission-gated):
 *   GET    /tenant/bonus-definitions          → lista paginada
 *   GET    /tenant/bonus-definitions/:id      → uno
 *   POST   /tenant/bonus-definitions          → crear (admin/empleado con permiso)
 *   PATCH  /tenant/bonus-definitions/:id      → editar
 *
 * No hay DELETE: las definitions con bonos otorgados activos no se
 * pueden borrar (rompe foreign key + auditoría). El admin las mueve a
 * status='archived' vía PATCH.
 */

import {
  Body,
  ConflictException,
  Controller,
  Get,
  HttpStatus,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import type { BonusDefinition } from '@casino/db';
import { AuditLogService } from '../audit/audit-log.service';
import {
  buildCsv,
  buildCsvFilename,
  CSV_EXPORT_MAX_ROWS,
  type CsvColumn,
} from '../common/csv';
import { PermissionsGuard } from '../permissions/permissions.guard';
import { RequirePermissions } from '../permissions/require-permissions.decorator';
import { extractRequestContext } from '../request-context/request-context';
import { CurrentTenantUser } from '../tenant-auth/decorators/current-tenant-user.decorator';
import { TenantJwtGuard } from '../tenant-auth/guards/tenant-jwt.guard';
import { PanelOnly } from '../tenant-auth/panel-only.decorator';
import type { RequestWithTenantContext } from '../tenant-resolver/tenant-context';
import { BonusDefinitionsService } from './bonus-definitions.service';
import {
  BonusDefinitionCodeConflictError,
  BonusDefinitionNotFoundError,
} from './bonuses.errors';
import {
  CreateBonusDefinitionDto,
  UpdateBonusDefinitionDto,
} from './dto/bonus-definition.dto';

@Controller('tenant/bonus-definitions')
@UseGuards(TenantJwtGuard, PermissionsGuard)
@PanelOnly()
export class BonusDefinitionsController {
  constructor(
    private readonly service: BonusDefinitionsService,
    private readonly audit: AuditLogService,
  ) {}

  @Get()
  @RequirePermissions('bonuses.view')
  async list(
    @Req() req: RequestWithTenantContext,
    @Query('status') status?: string,
    @Query('type') type?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const db = req.tenantContext!.db;
    const { data, total } = await this.service.list(db, {
      status,
      type,
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
    });
    return { data, total };
  }

  /**
   * GET /tenant/bonus-definitions/export
   * Export CSV con los mismos filtros que `list` (status, type).
   * Cap `CSV_EXPORT_MAX_ROWS`. Records audit `bonus.definition.export`.
   */
  @Get('export')
  @RequirePermissions('bonuses.export_definitions')
  async exportCsv(
    @Req() req: RequestWithTenantContext,
    @Res() res: Response,
    @CurrentTenantUser() actor: { id: string; username: string },
    @Query('status') status?: string,
    @Query('type') type?: string,
  ): Promise<void> {
    const db = req.tenantContext!.db;
    const { data, total } = await this.service.list(db, {
      status,
      type,
      limit: CSV_EXPORT_MAX_ROWS,
      offset: 0,
    });

    await this.audit.record(db, {
      actorUserId: actor.id,
      actorUsername: actor.username,
      actionCode: 'bonus.definition.export',
      targetType: 'bonus_definition',
      targetId: null,
      metadata: {
        rowCount: data.length,
        totalMatched: total,
        truncated: total > data.length,
        filters: { status: status ?? null, type: type ?? null },
        severity: 'medium',
      },
      ...extractRequestContext(req),
    });

    const csv = buildCsv<BonusDefinition>(BONUS_DEFINITION_CSV_COLUMNS, data);
    const filename = buildCsvFilename('bonus_definitions');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('X-Total-Rows', String(data.length));
    if (total > data.length) res.setHeader('X-Truncated', 'true');
    res.send(csv);
  }

  @Get(':id')
  @RequirePermissions('bonuses.view')
  async getById(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: RequestWithTenantContext,
  ) {
    const db = req.tenantContext!.db;
    try {
      return await this.service.findById(db, id);
    } catch (err) {
      if (err instanceof BonusDefinitionNotFoundError) {
        throw new NotFoundException({
          message: err.message,
          error: 'BONUS_DEFINITION_NOT_FOUND',
        });
      }
      throw err;
    }
  }

  @Post()
  @RequirePermissions('bonuses.create_definition')
  async create(
    @Body() dto: CreateBonusDefinitionDto,
    @Req() req: RequestWithTenantContext,
    @CurrentTenantUser() actor: { id: string; username: string },
  ) {
    const db = req.tenantContext!.db;
    let created;
    try {
      created = await this.service.create(db, actor.id, dto);
    } catch (err) {
      if (err instanceof BonusDefinitionCodeConflictError) {
        throw new ConflictException({
          statusCode: HttpStatus.CONFLICT,
          message: err.message,
          error: 'BONUS_DEFINITION_CODE_CONFLICT',
        });
      }
      throw err;
    }
    await this.audit.record(db, {
      actorUserId: actor.id,
      actorUsername: actor.username,
      actionCode: 'bonus.definition.create',
      targetType: 'bonus_definition',
      targetId: created.id,
      after: { code: created.code, type: created.type, status: created.status },
      metadata: { severity: 'medium' },
      ...extractRequestContext(req),
    });
    return created;
  }

  @Patch(':id')
  @RequirePermissions('bonuses.edit_definition')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateBonusDefinitionDto,
    @Req() req: RequestWithTenantContext,
    @CurrentTenantUser() actor: { id: string; username: string },
  ) {
    const db = req.tenantContext!.db;
    let before;
    try {
      before = await this.service.findById(db, id);
    } catch (err) {
      if (err instanceof BonusDefinitionNotFoundError) {
        throw new NotFoundException({
          message: err.message,
          error: 'BONUS_DEFINITION_NOT_FOUND',
        });
      }
      throw err;
    }
    const updated = await this.service.update(db, id, dto);
    await this.audit.record(db, {
      actorUserId: actor.id,
      actorUsername: actor.username,
      actionCode: 'bonus.definition.edit',
      targetType: 'bonus_definition',
      targetId: id,
      before: { status: before.status, name: before.name },
      after: { status: updated.status, name: updated.name },
      metadata: { severity: 'medium' },
      ...extractRequestContext(req),
    });
    return updated;
  }
}

// ──────────────────────────────────────────────────────────────────────
// CSV column definitions
// ──────────────────────────────────────────────────────────────────────

const BONUS_DEFINITION_CSV_COLUMNS: CsvColumn<BonusDefinition>[] = [
  { header: 'created_at', value: (r) => r.createdAt },
  { header: 'id', value: (r) => r.id },
  { header: 'code', value: (r) => r.code },
  { header: 'name', value: (r) => r.name },
  { header: 'type', value: (r) => r.type },
  { header: 'status', value: (r) => r.status },
  { header: 'expiration_days', value: (r) => r.expirationDays },
  { header: 'config', value: (r) => r.config },
  { header: 'wagering', value: (r) => r.wagering },
  { header: 'segment_filter', value: (r) => r.segmentFilter },
  { header: 'visibility', value: (r) => r.visibility },
  { header: 'funded_by_user_id', value: (r) => r.fundedByUserId },
  { header: 'created_by_user_id', value: (r) => r.createdByUserId },
  { header: 'updated_at', value: (r) => r.updatedAt },
];
