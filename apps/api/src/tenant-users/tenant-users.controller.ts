/**
 * TenantUsersController — endpoints de gestión de users dentro de un tenant.
 *
 * Demuestra el sistema de permisos: cada endpoint declara qué permiso atómico
 * exige. El PermissionsGuard valida contra el set efectivo del user logueado.
 */

import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { users } from '@casino/db';
import { CurrentTenantUser } from '../tenant-auth/decorators/current-tenant-user.decorator';
import { TenantJwtGuard } from '../tenant-auth/guards/tenant-jwt.guard';
import { PermissionsGuard } from '../permissions/permissions.guard';
import { RequirePermissions } from '../permissions/require-permissions.decorator';
import type { RequestWithTenantContext } from '../tenant-resolver/tenant-context';

@Controller('tenant/users')
@UseGuards(TenantJwtGuard, PermissionsGuard)
export class TenantUsersController {
  /**
   * GET /tenant/users
   * Lista todos los users del tenant.
   * Requiere `users.view_any` (admin_tenant lo tiene; cajero NO).
   */
  @Get()
  @RequirePermissions('users.view_any')
  async list(
    @Req() req: RequestWithTenantContext,
    @CurrentTenantUser()
    requester: { id: string; username: string },
  ): Promise<{
    data: Array<{
      id: string;
      username: string;
      email: string | null;
      displayName: string;
      status: string;
      createdAt: Date;
    }>;
    count: number;
    requestedBy: string;
  }> {
    if (!req.tenantContext) {
      // Esto no debería pasar (los guards garantizan tenantContext) — defensa.
      throw new Error('TenantContext faltante.');
    }
    const db = req.tenantContext.db;

    const rows = await db
      .select({
        id: users.id,
        username: users.username,
        email: users.email,
        displayName: users.displayName,
        status: users.status,
        createdAt: users.createdAt,
      })
      .from(users);

    return {
      data: rows,
      count: rows.length,
      requestedBy: requester.username,
    };
  }
}
