/**
 * EffectivePermissionsService — calcula el set de permisos REAL de un user.
 *
 * Fórmula completa (ver `docs/03-jerarquia-roles.md §3`):
 *   permisos(user) = UNION role_permissions de sus user_roles
 *                  + user_permission_overrides (effect = 'grant')
 *                  − user_permission_overrides (effect = 'revoke')
 *
 * Cache: por ahora cero. Cada llamada queryea DB (3 queries chicas).
 * Próximo: Redis con TTL 5 min e invalidación al cambiar roles/overrides
 * (`docs/13-escalabilidad.md §8`).
 */

import { Injectable, Logger } from '@nestjs/common';
import { eq, inArray } from 'drizzle-orm';
import {
  rolePermissions,
  userPermissionOverrides,
  userRoles,
} from '@casino/db';
import type { TenantDb } from '../tenant-resolver/tenant-context';

@Injectable()
export class EffectivePermissionsService {
  private readonly logger = new Logger(EffectivePermissionsService.name);

  /**
   * Set efectivo: roles → UNION → ± overrides.
   */
  async calculateForUser(db: TenantDb, userId: string): Promise<Set<string>> {
    const effective = new Set<string>();

    // 1. Roles del user → permisos de esos roles.
    const userRoleRows = await db
      .select({ roleId: userRoles.roleId })
      .from(userRoles)
      .where(eq(userRoles.userId, userId));

    if (userRoleRows.length > 0) {
      const roleIds = userRoleRows.map((r) => r.roleId);
      const permRows = await db
        .select({ permissionCode: rolePermissions.permissionCode })
        .from(rolePermissions)
        .where(inArray(rolePermissions.roleId, roleIds));
      for (const p of permRows) effective.add(p.permissionCode);
    }

    // 2. Overrides individuales (grant suma, revoke resta).
    const overrides = await db
      .select({
        permissionCode: userPermissionOverrides.permissionCode,
        effect: userPermissionOverrides.effect,
      })
      .from(userPermissionOverrides)
      .where(eq(userPermissionOverrides.userId, userId));

    for (const o of overrides) {
      if (o.effect === 'grant') effective.add(o.permissionCode);
      else if (o.effect === 'revoke') effective.delete(o.permissionCode);
    }

    this.logger.debug(
      `User ${userId}: ${userRoleRows.length} roles, ${overrides.length} overrides → ${effective.size} permisos efectivos`,
    );

    return effective;
  }

  async hasAllPermissions(
    db: TenantDb,
    userId: string,
    required: readonly string[],
  ): Promise<boolean> {
    if (required.length === 0) return true;
    const effective = await this.calculateForUser(db, userId);
    return required.every((perm) => effective.has(perm));
  }
}
