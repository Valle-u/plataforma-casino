/**
 * EffectivePermissionsService — calcula el set de permisos REAL de un user.
 *
 * Fórmula (ver `docs/03-jerarquia-roles.md §3`):
 *   permisos(user) = UNION role_permissions de sus user_roles
 *                  + user_permission_overrides (grant)        ← TODO próximo sprint
 *                  − user_permission_overrides (revoke)       ← TODO próximo sprint
 *
 * En este sprint solo tenemos la primera parte (UNION). Los overrides
 * individuales se implementan cuando agreguemos la tabla `user_permission_overrides`.
 *
 * Cache: por ahora cero. Cada llamada queryea DB. En una próxima iteración
 * cacheamos en Redis con TTL 5 min e invalidación al cambiar roles/overrides
 * (ver `docs/13-escalabilidad.md §8`).
 */

import { Injectable, Logger } from '@nestjs/common';
import { eq, inArray } from 'drizzle-orm';
import { rolePermissions, userRoles } from '@casino/db';
import type { TenantDb } from '../tenant-resolver/tenant-context';

@Injectable()
export class EffectivePermissionsService {
  private readonly logger = new Logger(EffectivePermissionsService.name);

  /**
   * Devuelve el set de permission codes que el user tiene actualmente.
   * Vacío si no tiene ningún rol asignado.
   */
  async calculateForUser(db: TenantDb, userId: string): Promise<Set<string>> {
    // 1. Roles asignados al user.
    const userRoleRows = await db
      .select({ roleId: userRoles.roleId })
      .from(userRoles)
      .where(eq(userRoles.userId, userId));

    if (userRoleRows.length === 0) {
      return new Set();
    }

    const roleIds = userRoleRows.map((r) => r.roleId);

    // 2. Permisos de esos roles (UNION).
    const permRows = await db
      .select({ permissionCode: rolePermissions.permissionCode })
      .from(rolePermissions)
      .where(inArray(rolePermissions.roleId, roleIds));

    const permissionsSet = new Set(permRows.map((p) => p.permissionCode));

    this.logger.debug(
      `User ${userId}: ${roleIds.length} role(s), ${permissionsSet.size} permiso(s) efectivo(s)`,
    );

    return permissionsSet;
  }

  /**
   * Verifica si el user tiene TODOS los permisos requeridos.
   * Devuelve true solo si los tiene todos. False si falta cualquiera.
   */
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
