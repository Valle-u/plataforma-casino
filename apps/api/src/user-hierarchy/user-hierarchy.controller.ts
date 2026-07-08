/**
 * UserHierarchyController — gestión de la jerarquía operativa del tenant.
 *
 * Endpoints:
 *   - GET    /tenant/user-hierarchy/:userId/parent    — parent activo.
 *   - GET    /tenant/user-hierarchy/:userId/descendants — IDs de la red.
 *   - GET    /tenant/user-hierarchy/:userId/ancestors — IDs hacia arriba.
 *   - PUT    /tenant/user-hierarchy/:userId/parent    — set parent.
 *   - DELETE /tenant/user-hierarchy/:userId/parent    — clear parent.
 *
 * Todos requieren `users.change_hierarchy` (no-delegable).
 * Audit log de set/clear con before/after.
 */

import {
  Body,
  ConflictException,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Put,
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
import { SetParentDto } from './dto/set-parent.dto';
import {
  HierarchyCycleError,
  OutOfScopeError,
  SelfParentError,
} from './user-hierarchy.errors';
import { UserHierarchyService } from './user-hierarchy.service';

@Controller('tenant/user-hierarchy')
@UseGuards(TenantJwtGuard, PermissionsGuard)
@PanelOnly()
export class UserHierarchyController {
  constructor(
    private readonly hierarchy: UserHierarchyService,
    private readonly audit: AuditLogService,
  ) {}

  @Get(':userId/parent')
  @RequirePermissions('users.view_any')
  async getParent(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Req() req: RequestWithTenantContext,
  ): Promise<{ parent: unknown }> {
    const db = req.tenantContext!.db;
    const parent = await this.hierarchy.getActiveParent(db, userId);
    return { parent };
  }

  @Get(':userId/ancestors')
  @RequirePermissions('users.view_any')
  async getAncestors(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Req() req: RequestWithTenantContext,
  ): Promise<{ userId: string; ancestors: string[]; count: number }> {
    const db = req.tenantContext!.db;
    const ancestors = await this.hierarchy.getActiveAncestors(db, userId);
    return { userId, ancestors, count: ancestors.length };
  }

  @Get(':userId/descendants')
  @RequirePermissions('users.view_any')
  async getDescendants(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Req() req: RequestWithTenantContext,
  ): Promise<{ userId: string; descendants: string[]; count: number }> {
    const db = req.tenantContext!.db;
    const descendants = await this.hierarchy.getActiveDescendants(db, userId);
    return { userId, descendants, count: descendants.length };
  }

  @Put(':userId/parent')
  @RequirePermissions('users.change_hierarchy')
  @HttpCode(HttpStatus.OK)
  async setParent(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() dto: SetParentDto,
    @Req() req: RequestWithTenantContext,
    @CurrentTenantUser() actor: { id: string; username: string },
  ): Promise<{ ok: true; relation: unknown }> {
    const db = req.tenantContext!.db;

    // Gap #2 jerarquías: un actor no-admin (socio/distribuidor) solo reparenta
    // DENTRO de su red — el hijo movido Y el nuevo padre deben caer en su
    // sub-red (assertScope bypassa admin_tenant). Cierra la escalada entre
    // redes: no puede robar un usuario de otra red ni empujarlo fuera de la suya.
    try {
      await this.hierarchy.assertScope(db, actor.id, userId);
      await this.hierarchy.assertScope(db, actor.id, dto.parentUserId);
    } catch (err) {
      if (err instanceof OutOfScopeError) {
        throw new ForbiddenException({
          message: err.message,
          error: 'OUT_OF_SCOPE',
        });
      }
      throw err;
    }

    const before = await this.hierarchy.getActiveParent(db, userId);
    let relation;
    try {
      relation = await this.hierarchy.setParent(db, {
        userId,
        parentUserId: dto.parentUserId,
        relationType: dto.relationType,
        actorUserId: actor.id,
      });
    } catch (err) {
      if (err instanceof SelfParentError) {
        throw new ConflictException({ message: err.message, error: 'SELF_PARENT' });
      }
      if (err instanceof HierarchyCycleError) {
        throw new ConflictException({ message: err.message, error: 'HIERARCHY_CYCLE' });
      }
      throw err;
    }

    await this.audit.record(db, {
      actorUserId: actor.id,
      actorUsername: actor.username,
      actionCode: 'users.set_parent',
      targetType: 'user',
      targetId: userId,
      before: before ? { parentUserId: before.parentUserId, relationType: before.relationType } : null,
      after: { parentUserId: dto.parentUserId, relationType: dto.relationType },
      metadata: { severity: 'high' },
      ...extractRequestContext(req),
    });

    return { ok: true, relation };
  }

  @Delete(':userId/parent')
  @RequirePermissions('users.change_hierarchy')
  @HttpCode(HttpStatus.OK)
  async clearParent(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Req() req: RequestWithTenantContext,
    @CurrentTenantUser() actor: { id: string; username: string },
  ): Promise<{ ok: true; cleared: boolean }> {
    const db = req.tenantContext!.db;

    // Gap #2: un actor no-admin solo puede clear-parent a un usuario DE SU red
    // (assertScope bypassa admin_tenant). No puede desenganchar usuarios ajenos.
    try {
      await this.hierarchy.assertScope(db, actor.id, userId);
    } catch (err) {
      if (err instanceof OutOfScopeError) {
        throw new ForbiddenException({
          message: err.message,
          error: 'OUT_OF_SCOPE',
        });
      }
      throw err;
    }

    const before = await this.hierarchy.getActiveParent(db, userId);
    if (!before) return { ok: true, cleared: false };

    await this.hierarchy.clearParent(db, userId);

    await this.audit.record(db, {
      actorUserId: actor.id,
      actorUsername: actor.username,
      actionCode: 'users.clear_parent',
      targetType: 'user',
      targetId: userId,
      before: { parentUserId: before.parentUserId, relationType: before.relationType },
      after: null,
      metadata: { severity: 'high' },
      ...extractRequestContext(req),
    });

    return { ok: true, cleared: true };
  }
}
