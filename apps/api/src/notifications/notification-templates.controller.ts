/**
 * NotificationTemplatesController — admin del tenant edita templates.
 *
 * Endpoints (todos requieren `tenant.notifications.templates.edit`):
 *   GET    /tenant/notification-templates              → lista overrides
 *   GET    /tenant/notification-templates/kinds        → kinds registrados
 *   GET    /tenant/notification-templates/:kind        → uno (o 404)
 *   POST   /tenant/notification-templates/:kind/preview → render con payload de prueba
 *   PATCH  /tenant/notification-templates/:kind        → upsert
 *   DELETE /tenant/notification-templates/:kind        → unset (vuelve a default)
 */

import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Logger,
  NotFoundException,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { IsBoolean, IsObject, IsOptional, IsString, MinLength } from 'class-validator';
import { AuditLogService } from '../audit/audit-log.service';
import { PermissionsGuard } from '../permissions/permissions.guard';
import { RequirePermissions } from '../permissions/require-permissions.decorator';
import { extractRequestContext } from '../request-context/request-context';
import { CurrentTenantUser } from '../tenant-auth/decorators/current-tenant-user.decorator';
import { TenantJwtGuard } from '../tenant-auth/guards/tenant-jwt.guard';
import { PanelOnly } from '../tenant-auth/panel-only.decorator';
import type { RequestWithTenantContext } from '../tenant-resolver/tenant-context';
import { NotificationTemplatesService } from './notification-templates.service';
import {
  REGISTERED_NOTIFICATION_KINDS,
  renderOverride,
  renderTemplate,
} from './notifications.templates';

class UpsertTemplateDto {
  @IsString()
  @MinLength(1, { message: 'subjectTemplate no puede ser vacío.' })
  subjectTemplate!: string;

  @IsString()
  @MinLength(1, { message: 'bodyTemplate no puede ser vacío.' })
  bodyTemplate!: string;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

class PreviewDto {
  @IsObject()
  payload!: Record<string, unknown>;
}

@Controller('tenant/notification-templates')
@UseGuards(TenantJwtGuard, PermissionsGuard)
@PanelOnly()
export class NotificationTemplatesController {
  private readonly logger = new Logger(NotificationTemplatesController.name);

  constructor(
    private readonly service: NotificationTemplatesService,
    private readonly audit: AuditLogService,
  ) {}

  /** Lista TODOS los overrides activos del tenant. */
  @Get()
  @RequirePermissions('tenant.notifications.templates.edit')
  async list(@Req() req: RequestWithTenantContext) {
    const db = req.tenantContext!.db;
    const data = await this.service.list(db);
    return { data };
  }

  /** Lista los kinds registrados en código (para popular dropdowns en UI). */
  @Get('kinds')
  @RequirePermissions('tenant.notifications.templates.edit')
  listKinds() {
    return { data: REGISTERED_NOTIFICATION_KINDS };
  }

  /**
   * Devuelve el override del kind. Si no existe, devuelve 404 con
   * indicación de que el default hardcoded sigue activo.
   */
  @Get(':kind')
  @RequirePermissions('tenant.notifications.templates.edit')
  async getByKind(
    @Param('kind') kind: string,
    @Req() req: RequestWithTenantContext,
  ) {
    const db = req.tenantContext!.db;
    const tpl = await this.service.findByKind(db, kind);
    if (!tpl) {
      throw new NotFoundException({
        message: `Sin override para kind '${kind}'. El default hardcoded está activo.`,
        error: 'NOTIFICATION_TEMPLATE_OVERRIDE_NOT_FOUND',
        kind,
      });
    }
    return tpl;
  }

  /**
   * POST /:kind/preview — renderiza el template con un payload de prueba.
   * Permite al admin ver cómo queda el render antes de guardar el override.
   *
   * Si en el body hay `subjectTemplate` + `bodyTemplate`, los usa SIN
   * persistir (preview de un draft). Si no, usa el override actual o el
   * default hardcoded.
   */
  @Post(':kind/preview')
  @RequirePermissions('tenant.notifications.templates.edit')
  @HttpCode(HttpStatus.OK)
  async preview(
    @Param('kind') kind: string,
    @Body() dto: PreviewDto & Partial<UpsertTemplateDto>,
    @Req() req: RequestWithTenantContext,
  ) {
    const db = req.tenantContext!.db;
    if (!REGISTERED_NOTIFICATION_KINDS.includes(kind)) {
      throw new BadRequestException({
        message: `Kind '${kind}' no registrado.`,
        error: 'NOTIFICATION_KIND_NOT_REGISTERED',
      });
    }

    // Caso 1: el admin pasó un draft de subject/body → preview con eso.
    if (dto.subjectTemplate && dto.bodyTemplate) {
      const rendered = renderOverride(
        dto.subjectTemplate,
        dto.bodyTemplate,
        dto.payload,
      );
      return { source: 'draft', ...rendered };
    }

    // Caso 2: sin draft → usar override actual si existe, sino default.
    const override = await this.service.findByKind(db, kind);
    if (override && override.enabled) {
      const rendered = renderOverride(
        override.subjectTemplate,
        override.bodyTemplate,
        dto.payload,
      );
      return { source: 'override', ...rendered };
    }
    try {
      const rendered = renderTemplate(kind, dto.payload);
      return { source: 'default', ...rendered };
    } catch (err) {
      // Defensivo: renderTemplate tira si el kind no tiene default.
      // Si llegamos acá es bug del registro, no del user.
      this.logger.error(
        `Preview fallido para kind=${kind}: ${(err as Error).message}`,
      );
      throw new BadRequestException({
        message: `No se pudo renderizar el default para '${kind}'.`,
        error: 'NOTIFICATION_DEFAULT_RENDER_FAILED',
      });
    }
  }

  /**
   * PATCH /:kind — upsert del override. Valida `kind` registrado.
   * Audit con severity:medium.
   */
  @Patch(':kind')
  @RequirePermissions('tenant.notifications.templates.edit')
  @HttpCode(HttpStatus.OK)
  async upsert(
    @Param('kind') kind: string,
    @Body() dto: UpsertTemplateDto,
    @Req() req: RequestWithTenantContext,
    @CurrentTenantUser() actor: { id: string; username: string },
  ) {
    const db = req.tenantContext!.db;
    const before = await this.service.findByKind(db, kind);
    const updated = await this.service.upsert(
      db,
      kind,
      {
        subjectTemplate: dto.subjectTemplate,
        bodyTemplate: dto.bodyTemplate,
        enabled: dto.enabled,
      },
      actor.id,
    );
    await this.audit.record(db, {
      actorUserId: actor.id,
      actorUsername: actor.username,
      actionCode: 'tenant.notification_template.set',
      targetType: 'notification_template',
      targetId: updated.id,
      before: before
        ? {
            subjectTemplate: before.subjectTemplate,
            bodyTemplate: before.bodyTemplate,
            enabled: before.enabled,
          }
        : null,
      after: {
        subjectTemplate: updated.subjectTemplate,
        bodyTemplate: updated.bodyTemplate,
        enabled: updated.enabled,
      },
      metadata: { severity: 'medium', kind },
      ...extractRequestContext(req),
    });
    return updated;
  }

  /**
   * DELETE /:kind — borra el override. El default hardcoded vuelve a
   * estar activo. Idempotent (si no existía, retorna 204 igual).
   */
  @Delete(':kind')
  @RequirePermissions('tenant.notifications.templates.edit')
  @HttpCode(HttpStatus.NO_CONTENT)
  async delete(
    @Param('kind') kind: string,
    @Req() req: RequestWithTenantContext,
    @CurrentTenantUser() actor: { id: string; username: string },
  ): Promise<void> {
    const db = req.tenantContext!.db;
    const before = await this.service.findByKind(db, kind);
    if (!before) return; // idempotent
    await this.service.delete(db, kind);
    await this.audit.record(db, {
      actorUserId: actor.id,
      actorUsername: actor.username,
      actionCode: 'tenant.notification_template.unset',
      targetType: 'notification_template',
      targetId: before.id,
      before: {
        subjectTemplate: before.subjectTemplate,
        bodyTemplate: before.bodyTemplate,
        enabled: before.enabled,
      },
      metadata: { severity: 'medium', kind },
      ...extractRequestContext(req),
    });
  }
}
