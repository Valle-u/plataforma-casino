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
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Patch,
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
import { PanelOnly } from '../tenant-auth/panel-only.decorator';
import type { RequestWithTenantContext } from '../tenant-resolver/tenant-context';
import { SetSettingDto } from './dto/set-setting.dto';
import { TenantSettingsHistoryRetentionCron } from './tenant-settings-history-retention.cron';
import { SETTING_SCHEMAS } from './tenant-settings.registry';
import { TenantSettingsService } from './tenant-settings.service';

@Controller('tenant/settings')
@UseGuards(TenantJwtGuard, PermissionsGuard)
@PanelOnly()
export class TenantSettingsController {
  constructor(
    private readonly service: TenantSettingsService,
    private readonly audit: AuditLogService,
    private readonly retentionCron: TenantSettingsHistoryRetentionCron,
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

    // Validación typed por key. Si la key tiene schema registrado, el
    // value DEBE pasarlo. Keys NO registradas se aceptan tal cual
    // (forward-compat — admin puede setear custom keys para features
    // futuras sin esperar code change).
    const schema = SETTING_SCHEMAS[key];
    let valueToStore: unknown = dto.value;
    if (schema) {
      const result = schema.safeParse(dto.value);
      if (!result.success) {
        throw new BadRequestException({
          message: `Value inválido para setting '${key}'.`,
          error: 'SETTING_VALUE_INVALID',
          key,
          issues: result.error.issues.map((i) => ({
            path: i.path,
            message: i.message,
            code: i.code,
          })),
        });
      }
      // Si el schema transforma (e.g. `.transform()`), usamos el output.
      // Hoy no transformamos, pero el patrón queda listo.
      valueToStore = result.data;
    }

    const before = await this.service.get<unknown>(db, key);
    const updated = await this.service.set(db, key, valueToStore, actor.id);
    await this.audit.record(db, {
      actorUserId: actor.id,
      actorUsername: actor.username,
      actionCode: 'tenant.setting.set',
      targetType: 'tenant_setting',
      targetId: null,
      before: before !== undefined ? { value: before } : null,
      after: { key, value: valueToStore },
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
    // Pasamos actor.id para que el history entry registre quién
    // unseteó. El service hace la TX (delete + history insert atomic).
    await this.service.unset(db, key, actor.id);
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

  /**
   * POST /tenant/settings/history/purge
   * Dispara manualmente la retención del history. Útil para
   * reconciliación / testing del flow. Lee el setting
   * `tenant_settings.history_retention_days` (default 365).
   */
  @Post('history/purge')
  @RequirePermissions('tenant.settings.edit')
  @HttpCode(HttpStatus.OK)
  async purgeHistory(
    @Req() req: RequestWithTenantContext,
    @CurrentTenantUser() actor: { id: string; username: string },
  ) {
    const db = req.tenantContext!.db;
    const result = await this.retentionCron.runForTenant(db);
    if (result.deleted > 0) {
      await this.audit.record(db, {
        actorUserId: actor.id,
        actorUsername: actor.username,
        actionCode: 'tenant.setting.history.purge.manual',
        targetType: 'tenant_settings_history',
        targetId: null,
        metadata: {
          severity: 'medium',
          deleted: result.deleted,
          retentionDays: result.retentionDaysApplied,
        },
        ...extractRequestContext(req),
      });
    }
    return result;
  }

  /**
   * GET /tenant/settings/:key/history
   * Lista cambios temporales del setting `key`. Paginado por `limit`/
   * `offset`. Ordenado por `changedAt` DESC (más reciente primero).
   */
  @Get(':key/history')
  @RequirePermissions('tenant.settings.edit')
  async historyForKey(
    @Param('key') key: string,
    @Req() req: RequestWithTenantContext,
  ) {
    const db = req.tenantContext!.db;
    const limitRaw = req.query['limit'];
    const offsetRaw = req.query['offset'];
    const limit = typeof limitRaw === 'string' ? Math.min(200, Number(limitRaw) || 50) : 50;
    const offset = typeof offsetRaw === 'string' ? Number(offsetRaw) || 0 : 0;
    const data = await this.service.listHistoryForKey(db, key, limit, offset);
    return { data };
  }
}
