/**
 * ResponsibleGamingController — endpoints player + admin.
 *
 * Player-facing (sin permission especial, solo TenantJwtGuard):
 *   - GET    /tenant/responsible-gaming/me           → mis settings.
 *   - PUT    /tenant/responsible-gaming/me           → upsert mis settings.
 *   - GET    /tenant/responsible-gaming/me/exclusion → exclusion activa o null.
 *   - POST   /tenant/responsible-gaming/me/exclude   → self-exclude.
 *
 * Admin-facing:
 *   - GET    /tenant/responsible-gaming/users/:id           (review)
 *   - PUT    /tenant/responsible-gaming/users/:id/limits    (admin_set)
 *   - POST   /tenant/responsible-gaming/users/:id/exclude   (admin_set)
 *   - POST   /tenant/responsible-gaming/exclusions/:id/revoke (admin_set)
 *
 * Audit: cada admin write deja entry severity:high con before/after.
 * Las mutations self-service también auditan (severity:medium) — el
 * jugador tiene que poder probar después "yo bajé mi límite a X".
 */

import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
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
import {
  CreateExclusionDto,
  RevokeExclusionDto,
  UpsertLimitsDto,
} from './dto/responsible-gaming.dto';
import {
  ExclusionAlreadyActiveError,
  ExclusionNotFoundError,
} from './responsible-gaming.errors';
import { ResponsibleGamingService } from './responsible-gaming.service';

@Controller('tenant/responsible-gaming')
@UseGuards(TenantJwtGuard, PermissionsGuard)
export class ResponsibleGamingController {
  constructor(
    private readonly service: ResponsibleGamingService,
    private readonly audit: AuditLogService,
  ) {}

  // ──────────────────────────────────────────────────────────────────────
  // Player-facing (self-service)
  // ──────────────────────────────────────────────────────────────────────

  @Get('me')
  async getMyLimits(
    @Req() req: RequestWithTenantContext,
    @CurrentTenantUser() actor: { id: string },
  ) {
    const db = req.tenantContext!.db;
    const [settings, exclusion] = await Promise.all([
      this.service.getSettings(db, actor.id),
      this.service.getActiveExclusion(db, actor.id),
    ]);
    return { settings, exclusion };
  }

  @Patch('me')
  async upsertMyLimits(
    @Body() dto: UpsertLimitsDto,
    @Req() req: RequestWithTenantContext,
    @CurrentTenantUser() actor: { id: string; username: string },
  ) {
    const db = req.tenantContext!.db;
    const before = await this.service.getSettings(db, actor.id);
    // El player NO puede setear `ageConfirmedMin` por sí mismo (compliance
    // dictamina la edad mínima, no lo elige el user).
    const { ageConfirmedMin: _ignore, reason: _ignoreReason, ...patch } = dto;
    void _ignore;
    void _ignoreReason;
    const updated = await this.service.upsertSettings(
      db,
      actor.id,
      patch,
      actor.id,
    );
    await this.audit.record(db, {
      actorUserId: actor.id,
      actorUsername: actor.username,
      actionCode: 'responsible_gaming.self_set',
      targetType: 'responsible_gaming_settings',
      targetId: actor.id,
      before: pruneAudit(before),
      after: pruneAudit(updated),
      metadata: { severity: 'medium' },
      ...extractRequestContext(req),
    });
    return updated;
  }

  @Get('me/exclusion')
  async getMyExclusion(
    @Req() req: RequestWithTenantContext,
    @CurrentTenantUser() actor: { id: string },
  ) {
    const db = req.tenantContext!.db;
    return { exclusion: await this.service.getActiveExclusion(db, actor.id) };
  }

  @Post('me/exclude')
  @HttpCode(HttpStatus.CREATED)
  async selfExclude(
    @Body() dto: CreateExclusionDto,
    @Req() req: RequestWithTenantContext,
    @CurrentTenantUser() actor: { id: string; username: string },
  ) {
    const db = req.tenantContext!.db;
    const endsAt = parseEndsAt(dto);
    try {
      const created = await this.service.createExclusion(
        db,
        actor.id,
        { type: dto.type, endsAt, reason: dto.reason ?? null },
        actor.id,
      );
      await this.audit.record(db, {
        actorUserId: actor.id,
        actorUsername: actor.username,
        actionCode: 'responsible_gaming.self_exclude',
        targetType: 'self_exclusion',
        targetId: created.id,
        after: {
          type: created.type,
          endsAt: created.endsAt,
        },
        metadata: { severity: 'high' },
        ...extractRequestContext(req),
      });
      return created;
    } catch (err) {
      throw this.mapError(err);
    }
  }

  // ──────────────────────────────────────────────────────────────────────
  // Admin-facing
  // ──────────────────────────────────────────────────────────────────────

  @Get('users/:id')
  @RequirePermissions('responsible_gaming.review')
  async getForUser(
    @Param('id', ParseUUIDPipe) userId: string,
    @Req() req: RequestWithTenantContext,
  ) {
    const db = req.tenantContext!.db;
    const [settings, exclusion] = await Promise.all([
      this.service.getSettings(db, userId),
      this.service.getActiveExclusion(db, userId),
    ]);
    return { settings, exclusion };
  }

  @Patch('users/:id/limits')
  @RequirePermissions('responsible_gaming.admin_set')
  async forceSettings(
    @Param('id', ParseUUIDPipe) userId: string,
    @Body() dto: UpsertLimitsDto,
    @Req() req: RequestWithTenantContext,
    @CurrentTenantUser() actor: { id: string; username: string },
  ) {
    if (!dto.reason || dto.reason.trim() === '') {
      throw new BadRequestException({
        message: 'reason requerido cuando admin forza límites.',
        error: 'REASON_REQUIRED',
      });
    }
    const db = req.tenantContext!.db;
    const before = await this.service.getSettings(db, userId);
    const { reason, ...patch } = dto;
    const updated = await this.service.upsertSettings(
      db,
      userId,
      patch,
      actor.id,
      reason,
    );
    await this.audit.record(db, {
      actorUserId: actor.id,
      actorUsername: actor.username,
      actionCode: 'responsible_gaming.admin_set',
      targetType: 'responsible_gaming_settings',
      targetId: userId,
      before: pruneAudit(before),
      after: pruneAudit(updated),
      metadata: { severity: 'high', reason },
      ...extractRequestContext(req),
    });
    return updated;
  }

  @Post('users/:id/exclude')
  @RequirePermissions('responsible_gaming.admin_set')
  @HttpCode(HttpStatus.CREATED)
  async forceExclude(
    @Param('id', ParseUUIDPipe) userId: string,
    @Body() dto: CreateExclusionDto,
    @Req() req: RequestWithTenantContext,
    @CurrentTenantUser() actor: { id: string; username: string },
  ) {
    const db = req.tenantContext!.db;
    const endsAt = parseEndsAt(dto);
    try {
      const created = await this.service.createExclusion(
        db,
        userId,
        { type: dto.type, endsAt, reason: dto.reason ?? null },
        actor.id,
      );
      await this.audit.record(db, {
        actorUserId: actor.id,
        actorUsername: actor.username,
        actionCode: 'responsible_gaming.admin_exclude',
        targetType: 'self_exclusion',
        targetId: created.id,
        after: {
          userId,
          type: created.type,
          endsAt: created.endsAt,
          reason: created.reason,
        },
        metadata: { severity: 'high' },
        ...extractRequestContext(req),
      });
      return created;
    } catch (err) {
      throw this.mapError(err);
    }
  }

  @Post('exclusions/:id/revoke')
  @RequirePermissions('responsible_gaming.admin_set')
  @HttpCode(HttpStatus.OK)
  async revokeExclusion(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RevokeExclusionDto,
    @Req() req: RequestWithTenantContext,
    @CurrentTenantUser() actor: { id: string; username: string },
  ) {
    const db = req.tenantContext!.db;
    try {
      const revoked = await this.service.revokeExclusion(
        db,
        id,
        actor.id,
        dto.reason,
      );
      await this.audit.record(db, {
        actorUserId: actor.id,
        actorUsername: actor.username,
        actionCode: 'responsible_gaming.revoke_exclusion',
        targetType: 'self_exclusion',
        targetId: id,
        before: { status: 'active' },
        after: { status: 'revoked', reason: dto.reason },
        metadata: { severity: 'high' },
        ...extractRequestContext(req),
      });
      return revoked;
    } catch (err) {
      throw this.mapError(err);
    }
  }

  // ──────────────────────────────────────────────────────────────────────
  // Helpers
  // ──────────────────────────────────────────────────────────────────────

  private mapError(err: unknown): Error {
    if (err instanceof ExclusionAlreadyActiveError) {
      return new ConflictException({
        message: err.message,
        error: 'EXCLUSION_ALREADY_ACTIVE',
      });
    }
    if (err instanceof ExclusionNotFoundError) {
      return new NotFoundException({
        message: err.message,
        error: 'EXCLUSION_NOT_FOUND',
      });
    }
    if (err instanceof Error && err.message.includes('requiere endsAt')) {
      return new BadRequestException({
        message: err.message,
        error: 'EXCLUSION_ENDS_AT_REQUIRED',
      });
    }
    return err as Error;
  }
}

function parseEndsAt(dto: CreateExclusionDto): Date | null {
  if (dto.type === 'permanent') return null;
  if (!dto.endsAt) return null; // service detecta y tira
  return new Date(dto.endsAt);
}

/** Quita campos administrativos del audit (reason, timestamps) — la
 *  intención es ver solo qué cambió en los valores, no metadata. */
function pruneAudit(s: unknown): Record<string, unknown> | null {
  if (!s || typeof s !== 'object') return null;
  const obj = s as Record<string, unknown>;
  const {
    updatedByUserId: _a,
    updatedByReason: _b,
    createdAt: _c,
    updatedAt: _d,
    ...rest
  } = obj;
  void _a;
  void _b;
  void _c;
  void _d;
  return rest;
}
