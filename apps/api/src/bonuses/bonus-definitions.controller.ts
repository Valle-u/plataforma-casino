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
  UseGuards,
} from '@nestjs/common';
import { AuditLogService } from '../audit/audit-log.service';
import { PermissionsGuard } from '../permissions/permissions.guard';
import { RequirePermissions } from '../permissions/require-permissions.decorator';
import { extractRequestContext } from '../request-context/request-context';
import { CurrentTenantUser } from '../tenant-auth/decorators/current-tenant-user.decorator';
import { TenantJwtGuard } from '../tenant-auth/guards/tenant-jwt.guard';
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
