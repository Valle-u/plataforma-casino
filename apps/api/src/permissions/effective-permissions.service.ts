/**
 * EffectivePermissionsService — calcula el set de permisos REAL de un user.
 *
 * Fórmula completa (ver `docs/03-jerarquia-roles.md §3`):
 *   permisos(user) = UNION role_permissions de sus user_roles
 *                  + user_permission_overrides (effect = 'grant')
 *                  − user_permission_overrides (effect = 'revoke')
 *
 * Cache en Redis: el resultado de `calculateRaw` se guarda 5 min.
 * La clave es `perms:<userId>`. Se invalida al cambiar roles/overrides
 * o al togglear independencia (ver docs/13-escalabilidad.md §8).
 */

import { Injectable, Logger } from '@nestjs/common';
import { eq, inArray, sql } from 'drizzle-orm';
import {
  roles,
  rolePermissions,
  userPermissionOverrides,
  userRoles,
} from '@casino/db';
import type { TenantDb } from '../tenant-resolver/tenant-context';
import { RedisService } from '../redis/redis.service';
import { expandAdminNetworkAliases } from './admin-network-aliases';
import { INDEPENDENT_OPERATOR_MONEY_PERMISSIONS } from './independent-money-perms';

/**
 * Roles OPERADORES: los que —en una sub-red independiente— mueven plata (y que
 * en el modelo viejo traían los perms de plata por `role_permissions`). El
 * cálculo dinámico del paso 3 solo re-agrega esos perms a estos roles; jugadores
 * y empleados independientes NO los heredan por pertenecer a la sub-red.
 */
const OPERATOR_ROLE_CODES = new Set<string>(['socio', 'distribuidor', 'cajero']);

@Injectable()
export class EffectivePermissionsService {
  private readonly logger = new Logger(EffectivePermissionsService.name);

  constructor(private readonly redis: RedisService) {}

  /**
   * Set efectivo (expandido): roles → UNION → ± overrides, y luego
   * expandAdminNetworkAliases suma el permiso base cada vez que el
   * user tiene el alias `*_admin_network`. Todos los consumers ven el
   * set expandido por default, así el gate del PermissionsGuard pasa
   * transparentemente con solo el alias.
   *
   * Cache en Redis (5 min TTL). Si Redis está deshabilitado, calcula
   * desde DB siempre.
   *
   * Para el set RAW (sin expandir), usar `calculateRaw`.
   */
  async calculateForUser(db: TenantDb, userId: string): Promise<Set<string>> {
    // 1. Intentar cache
    const cached = await this.redis.get<string[]>(`perms:${userId}`);
    if (cached !== null) {
      const effective = new Set(cached);
      expandAdminNetworkAliases(effective);
      return effective;
    }

    // 2. Calcular desde DB
    const raw = await this.calculateRaw(db, userId);

    // 3. Guardar en cache (solo si Redis está habilitado)
    if (this.redis.isEnabled()) {
      await this.redis.set(`perms:${userId}`, Array.from(raw), 300);
    }

    // 4. Expandir aliases y devolver
    expandAdminNetworkAliases(raw);
    return raw;
  }

  /**
   * Invalida el cache de permisos para un usuario. Llamar después de
   * modificar roles, overrides o independencia de ese usuario.
   */
  async deleteCacheForUser(userId: string): Promise<void> {
    await this.redis.del(`perms:${userId}`);
  }

  /**
   * Set efectivo SIN expandir aliases. Útil para auditoría / matrix UI
   * donde interesa ver exactamente qué permisos individuales tiene el
   * user (no sus implicancias).
   */
  async calculateRaw(db: TenantDb, userId: string): Promise<Set<string>> {
    const effective = new Set<string>();

    // 1. Roles del user → permisos de esos roles. Traemos también el `code`
    //    del rol para el gate del paso 3 (solo roles operadores mueven plata).
    const userRoleRows = await db
      .select({ roleId: userRoles.roleId, roleCode: roles.code })
      .from(userRoles)
      .innerJoin(roles, eq(roles.id, userRoles.roleId))
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

    // 3. LEYES R3/R4: los permisos de MOVER plata NO viven en el rol operador
    //    (un dependiente es comercial puro). Se agregan DINÁMICAMENTE SOLO a
    //    usuarios que (a) tienen un rol OPERADOR (socio/distribuidor/cajero) —
    //    los únicos que traían estos perms por rol en el modelo viejo— Y (b)
    //    están dentro de una sub-red INDEPENDIENTE (ellos o un ancestro es
    //    is_independent_branch). Así los operadores dependientes nunca los
    //    tienen, los independientes siempre, y un jugador/empleado independiente
    //    NO los hereda (un jugador con wallet.load sería una fuga). El gate por
    //    rol además evita correr la query de sub-red para no-operadores. Un
    //    `revoke` explícito (paso 2) igual puede sacarlos.
    const isOperator = userRoleRows.some((r) =>
      OPERATOR_ROLE_CODES.has(r.roleCode),
    );
    if (isOperator && (await this.isInIndependentSubtree(db, userId))) {
      for (const code of INDEPENDENT_OPERATOR_MONEY_PERMISSIONS) {
        if (!this.wasExplicitlyRevoked(overrides, code)) effective.add(code);
      }
    }

    this.logger.debug(
      `User ${userId}: ${userRoleRows.length} roles, ${overrides.length} overrides → ${effective.size} permisos efectivos (raw)`,
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

  /** True si el user o alguno de sus ancestros es `is_independent_branch`. */
  private async isInIndependentSubtree(
    db: TenantDb,
    userId: string,
  ): Promise<boolean> {
    const result = await db.execute(sql`
      WITH RECURSIVE chain AS (
        SELECT id, is_independent_branch FROM users WHERE id = ${userId}
        UNION
        SELECT parent.id, parent.is_independent_branch
        FROM chain c
        JOIN user_hierarchy uh ON uh.user_id = c.id AND uh.until IS NULL
        JOIN users parent ON parent.id = uh.parent_user_id
      )
      SELECT bool_or(COALESCE(is_independent_branch, false)) AS indep FROM chain
    `);
    const rows = ((result as unknown as { rows?: Array<{ indep: boolean }> })
      .rows ?? (result as unknown as Array<{ indep: boolean }>)) as Array<{
      indep: boolean;
    }>;
    return rows[0]?.indep === true;
  }

  private wasExplicitlyRevoked(
    overrides: ReadonlyArray<{ permissionCode: string; effect: string }>,
    code: string,
  ): boolean {
    return overrides.some(
      (o) => o.permissionCode === code && o.effect === 'revoke',
    );
  }
}
