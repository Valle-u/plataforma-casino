/**
 * PermissionOverridesController — endpoints para grant/revoke individuales.
 *
 * Requieren:
 *   - JWT del tenant (admin del tenant o quien tenga `permissions.grant` / `permissions.revoke`).
 *   - Permission atómico correspondiente.
 *
 * El admin del tenant tiene ambos permisos (en seed); cualquier otro user
 * los necesita explícitamente delegados.
 */

import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { and, asc, eq } from 'drizzle-orm';
import { userPermissionOverrides } from '@casino/db';
import { CurrentTenantUser } from '../tenant-auth/decorators/current-tenant-user.decorator';
import { TenantJwtGuard } from '../tenant-auth/guards/tenant-jwt.guard';
import type { RequestWithTenantContext } from '../tenant-resolver/tenant-context';
import { GrantPermissionDto, RevokePermissionDto } from './dto/grant-permission.dto';
import { PermissionsGuard } from './permissions.guard';
import { RequirePermissions } from './require-permissions.decorator';

@Controller('tenant/permission-overrides')
@UseGuards(TenantJwtGuard, PermissionsGuard)
export class PermissionOverridesController {
  /**
   * GET /tenant/permission-overrides/user/:userId
   * Lista los overrides (grant/revoke) que tiene un user.
   * Útil para que el panel de admin muestre el estado actual de overrides
   * antes de proponer un nuevo grant/revoke/clear.
   * Requiere `users.view_any`.
   */
  @Get('user/:userId')
  @RequirePermissions('users.view_any')
  async listForUser(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Req() req: RequestWithTenantContext,
  ): Promise<{
    userId: string;
    overrides: Array<{
      permissionCode: string;
      effect: 'grant' | 'revoke';
      reason: string | null;
      grantedBy: string | null;
      grantedAt: Date;
    }>;
    count: number;
  }> {
    const db = req.tenantContext!.db;
    const rows = await db
      .select({
        permissionCode: userPermissionOverrides.permissionCode,
        effect: userPermissionOverrides.effect,
        reason: userPermissionOverrides.reason,
        grantedBy: userPermissionOverrides.grantedBy,
        grantedAt: userPermissionOverrides.grantedAt,
      })
      .from(userPermissionOverrides)
      .where(eq(userPermissionOverrides.userId, userId))
      .orderBy(asc(userPermissionOverrides.permissionCode));

    return { userId, overrides: rows, count: rows.length };
  }

  /**
   * POST /tenant/permission-overrides/grant
   * Otorga un permiso individual a un user (override 'grant').
   * Requiere `permissions.grant`.
   */
  @Post('grant')
  @RequirePermissions('permissions.grant')
  @HttpCode(HttpStatus.CREATED)
  async grant(
    @Body() dto: GrantPermissionDto,
    @Req() req: RequestWithTenantContext,
    @CurrentTenantUser() actor: { id: string; username: string },
  ): Promise<{ ok: true; effect: 'grant' }> {
    const db = req.tenantContext!.db;
    await db
      .insert(userPermissionOverrides)
      .values({
        userId: dto.userId,
        permissionCode: dto.permissionCode,
        effect: 'grant',
        grantedBy: actor.id,
        grantedByChain: [actor.id],
        reason: dto.reason ?? null,
      })
      .onConflictDoUpdate({
        target: [userPermissionOverrides.userId, userPermissionOverrides.permissionCode],
        set: {
          effect: 'grant',
          grantedBy: actor.id,
          grantedByChain: [actor.id],
          reason: dto.reason ?? null,
          grantedAt: new Date(),
        },
      });
    return { ok: true, effect: 'grant' };
  }

  /**
   * POST /tenant/permission-overrides/revoke
   * Revoca explícitamente un permiso (override 'revoke').
   * Útil para "el cajero X no puede hacer wallet.unload" aunque su rol lo permita.
   * Requiere `permissions.revoke`. Reason obligatorio.
   */
  @Post('revoke')
  @RequirePermissions('permissions.revoke')
  @HttpCode(HttpStatus.CREATED)
  async revoke(
    @Body() dto: RevokePermissionDto,
    @Req() req: RequestWithTenantContext,
    @CurrentTenantUser() actor: { id: string; username: string },
  ): Promise<{ ok: true; effect: 'revoke' }> {
    const db = req.tenantContext!.db;
    await db
      .insert(userPermissionOverrides)
      .values({
        userId: dto.userId,
        permissionCode: dto.permissionCode,
        effect: 'revoke',
        grantedBy: actor.id,
        grantedByChain: [actor.id],
        reason: dto.reason,
      })
      .onConflictDoUpdate({
        target: [userPermissionOverrides.userId, userPermissionOverrides.permissionCode],
        set: {
          effect: 'revoke',
          grantedBy: actor.id,
          grantedByChain: [actor.id],
          reason: dto.reason,
          grantedAt: new Date(),
        },
      });
    return { ok: true, effect: 'revoke' };
  }

  /**
   * POST /tenant/permission-overrides/clear
   * Quita un override (deja al user con solo lo que sus roles le dan).
   * Requiere `permissions.revoke`.
   */
  @Post('clear')
  @RequirePermissions('permissions.revoke')
  @HttpCode(HttpStatus.NO_CONTENT)
  async clear(
    @Body() dto: { userId: string; permissionCode: string },
    @Req() req: RequestWithTenantContext,
  ): Promise<void> {
    const db = req.tenantContext!.db;
    await db
      .delete(userPermissionOverrides)
      .where(
        and(
          eq(userPermissionOverrides.userId, dto.userId),
          eq(userPermissionOverrides.permissionCode, dto.permissionCode),
        ),
      );
  }
}
