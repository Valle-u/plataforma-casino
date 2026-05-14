/**
 * TenantSettingsController — admin del tenant edita settings runtime.
 *
 * Endpoints:
 *   GET    /tenant/settings              — lista todos
 *   GET    /tenant/settings/:key         — uno (404 si no existe)
 *   PATCH  /tenant/settings/:key         — upsert (body: {value})
 *   DELETE /tenant/settings/:key         — unset (revierte al default
 *                                          que el consumer use)
 */

import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Patch,
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
import { SetSettingDto } from './dto/set-setting.dto';
import { TenantSettingsService } from './tenant-settings.service';

@Controller('tenant/settings')
@UseGuards(TenantJwtGuard, PermissionsGuard)
export class TenantSettingsController {
  constructor(
    private readonly service: TenantSettingsService,
    private readonly audit: AuditLogService,
  ) {}

  @Get()
  @RequirePermissions('tenant.settings.edit')
  async list(@Req() req: RequestWithTenantContext) {
    const db = req.tenantContext!.db;
    const data = await this.service.list(db);
    return { data };
  }

  @Get(':key')
  @RequirePermissions('tenant.settings.edit')
  async get(
    @Param('key') key: string,
    @Req() req: RequestWithTenantContext,
  ) {
    const db = req.tenantContext!.db;
    const value = await this.service.get<unknown>(db, key);
    if (value === undefined) {
      throw new NotFoundException({
        message: `Setting '${key}' no está configurado.`,
        error: 'SETTING_NOT_FOUND',
      });
    }
    return { key, value };
  }

  @Patch(':key')
  @RequirePermissions('tenant.settings.edit')
  @HttpCode(HttpStatus.OK)
  async set(
    @Param('key') key: string,
    @Body() dto: SetSettingDto,
    @Req() req: RequestWithTenantContext,
    @CurrentTenantUser() actor: { id: string; username: string },
  ) {
    const db = req.tenantContext!.db;
    const before = await this.service.get<unknown>(db, key);
    const updated = await this.service.set(db, key, dto.value, actor.id);
    await this.audit.record(db, {
      actorUserId: actor.id,
      actorUsername: actor.username,
      actionCode: 'tenant.setting.set',
      targetType: 'tenant_setting',
      targetId: null,
      before: before !== undefined ? { value: before } : null,
      after: { key, value: dto.value },
      metadata: { severity: 'medium', key },
      ...extractRequestContext(req),
    });
    return updated;
  }

  @Delete(':key')
  @RequirePermissions('tenant.settings.edit')
  @HttpCode(HttpStatus.NO_CONTENT)
  async unset(
    @Param('key') key: string,
    @Req() req: RequestWithTenantContext,
    @CurrentTenantUser() actor: { id: string; username: string },
  ): Promise<void> {
    const db = req.tenantContext!.db;
    const before = await this.service.get<unknown>(db, key);
    if (before === undefined) return; // idempotent
    await this.service.unset(db, key);
    await this.audit.record(db, {
      actorUserId: actor.id,
      actorUsername: actor.username,
      actionCode: 'tenant.setting.unset',
      targetType: 'tenant_setting',
      targetId: null,
      before: { value: before },
      metadata: { severity: 'medium', key },
      ...extractRequestContext(req),
    });
  }
}
