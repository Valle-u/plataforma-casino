/**
 * PermissionOverridesService — Sprint 51.5.
 *
 * Lógica reutilizable de grant de overrides (extraída del controller para
 * que `TenantUsersController.create` pueda otorgar permisos en bloque al
 * crear un empleado dentro de la misma TX).
 *
 * El controller `permission-overrides.controller.ts` sigue manejando los
 * endpoints HTTP + el audit log + el revoke/clear cascade.
 *
 * Reglas (validadas acá):
 *   1. El permission existe en el catálogo (sino BadRequest).
 *   2. El permission es delegable (sino Forbidden).
 *   3. El actor lo tiene en su set efectivo (sino Forbidden — "techo").
 *   4. El actor NO es empleado-only (sino Forbidden — los empleados no
 *      sub-delegan, son hojas del árbol).
 */

import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import {
  permissions as permissionsTable,
  roles,
  userPermissionOverrides,
  userRoles,
} from '@casino/db';
import type { TenantDb } from '../tenant-resolver/tenant-context';
import { EffectivePermissionsService } from './effective-permissions.service';
import { UserHierarchyService } from '../user-hierarchy/user-hierarchy.service';
import { DEPENDENT_BRANCH_EMPLOYEE_DENY_PERMISSIONS } from '../tenant-users/tenant-users.service';

/**
 * H1a-2: los codes de esta lista NO pueden ser otorgados por override si el
 * actor cae en una rama de socio dependiente (o él mismo es socio dep).
 * Sin esto, un socio dep podría crear un cajero (F1.1a le inserta revokes),
 * y después llamar POST /permission-overrides con `deposits.approve` para
 * pisar el revoke con un grant. La política de F1.1a quedaría burlada.
 * El admin_tenant NUNCA cae en la deny-list (bypasa por rol arriba).
 */
const DEP_BRANCH_OVERRIDE_DENY_SET = new Set<string>(
  DEPENDENT_BRANCH_EMPLOYEE_DENY_PERMISSIONS as readonly string[],
);

export interface GrantOverrideParams {
  actorUserId: string;
  targetUserId: string;
  permissionCode: string;
  reason?: string | null;
}

export interface GrantOverrideResult {
  /** Override previo (si existía) — el caller lo usa para audit before/after. */
  prev: typeof userPermissionOverrides.$inferSelect | null;
  /** granted_by_chain construido para este nuevo grant. */
  chain: string[];
}

@Injectable()
export class PermissionOverridesService {
  constructor(
    private readonly effective: EffectivePermissionsService,
    private readonly hierarchy: UserHierarchyService,
  ) {}

  /**
   * H1a-2: retorna true si el actor NO es admin_tenant Y cae en una sub-red
   * de socio independiente. Si cae en una sub-red indep, la política de F1.1a
   * NO aplica (el indep tiene autonomía). En cualquier otro caso (actor bajo
   * un socio dep, o él mismo un socio dep), aplicamos la deny-list.
   */
  private async actorInDependentBranch(
    db: TenantDb,
    actorUserId: string,
  ): Promise<boolean> {
    // admin_tenant nunca cae en la deny-list
    const roleRows = await db
      .select({ code: roles.code })
      .from(userRoles)
      .innerJoin(roles, eq(roles.id, userRoles.roleId))
      .where(eq(userRoles.userId, actorUserId));
    const roleCodes = roleRows.map((r) => r.code);
    if (roleCodes.includes('admin_tenant')) return false;

    // Si el actor cuelga de una sub-red indep, tampoco aplica.
    const indepSubtree = await this.hierarchy.getIndependentSubtreeIds(db);
    if (indepSubtree.has(actorUserId)) return false;

    // Cualquier otra cosa (socio dep, cajero/distribuidor/empleado bajo socio
    // dep, admin sin rol admin_tenant por error): política aplica.
    return true;
  }

  /**
   * Otorga un override 'grant' a un user. Validaciones según reglas
   * del Sprint 51.5 (ver docstring del módulo).
   */
  async grant(
    db: TenantDb,
    params: GrantOverrideParams,
  ): Promise<GrantOverrideResult> {
    // 1. Catálogo + delegable.
    const permRows = await db
      .select({
        code: permissionsTable.code,
        isDelegatable: permissionsTable.isDelegatable,
      })
      .from(permissionsTable)
      .where(eq(permissionsTable.code, params.permissionCode))
      .limit(1);
    const perm = permRows[0];
    if (!perm) {
      throw new BadRequestException(
        `Permiso "${params.permissionCode}" no existe en el catálogo.`,
      );
    }
    if (!perm.isDelegatable) {
      throw new ForbiddenException(
        `El permiso "${params.permissionCode}" no es delegable (is_delegatable=false).`,
      );
    }

    // 2. El actor NO puede ser empleado-only (Sprint 51.5: empleados son
    //    hojas, no sub-delegan).
    await this.assertActorCanDelegate(db, params.actorUserId);

    // 2.5 (H1a-2): la política F1.1a se cerraría vía override si no cortamos
    //     acá. Si el actor cae en rama dependiente Y el code está en la
    //     deny-list de F1.1a, rechazamos con 403 aunque el actor tenga el
    //     perm en su set. El admin NUNCA cae acá (actorInDependentBranch=false).
    if (DEP_BRANCH_OVERRIDE_DENY_SET.has(params.permissionCode)) {
      if (await this.actorInDependentBranch(db, params.actorUserId)) {
        throw new ForbiddenException(
          `No podés otorgar "${params.permissionCode}" a usuarios de una rama de socio dependiente. Este permiso solo puede ser otorgado por el admin del tenant.`,
        );
      }
    }

    // 3. Regla del techo: el actor debe tener ese permiso en su set efectivo.
    const actorHas = await this.effective.hasAllPermissions(
      db,
      params.actorUserId,
      [params.permissionCode],
    );
    if (!actorHas) {
      throw new ForbiddenException(
        `No podés otorgar "${params.permissionCode}" porque vos mismo no lo tenés.`,
      );
    }

    const chain = await this.buildChain(
      db,
      params.actorUserId,
      params.permissionCode,
    );

    const prevRows = await db
      .select()
      .from(userPermissionOverrides)
      .where(
        and(
          eq(userPermissionOverrides.userId, params.targetUserId),
          eq(userPermissionOverrides.permissionCode, params.permissionCode),
        ),
      )
      .limit(1);

    await db
      .insert(userPermissionOverrides)
      .values({
        userId: params.targetUserId,
        permissionCode: params.permissionCode,
        effect: 'grant',
        grantedBy: params.actorUserId,
        grantedByChain: chain,
        reason: params.reason ?? null,
      })
      .onConflictDoUpdate({
        target: [
          userPermissionOverrides.userId,
          userPermissionOverrides.permissionCode,
        ],
        set: {
          effect: 'grant',
          grantedBy: params.actorUserId,
          grantedByChain: chain,
          reason: params.reason ?? null,
          grantedAt: new Date(),
        },
      });

    return { prev: prevRows[0] ?? null, chain };
  }

  /**
   * Sprint 51.5: lista los permission codes que el actor PUEDE otorgar:
   *   - El actor los tiene en su set efectivo.
   *   - Son `isDelegatable=true`.
   *
   * NO incluye los que el actor tiene pero son no-delegables.
   * Si el actor es empleado-only, devuelve array vacío (defensa en
   * profundidad — el frontend debería ocultar el botón antes).
   */
  async getGrantableForActor(
    db: TenantDb,
    actorUserId: string,
  ): Promise<string[]> {
    // Empleados no delegan.
    if (await this.isEmpleadoOnly(db, actorUserId)) return [];

    const effectiveSet = await this.effective.calculateForUser(db, actorUserId);
    if (effectiveSet.size === 0) return [];

    const delegableRows = await db
      .select({ code: permissionsTable.code })
      .from(permissionsTable)
      .where(eq(permissionsTable.isDelegatable, true));
    const delegableCodes = new Set(delegableRows.map((r) => r.code));

    return [...effectiveSet].filter((code) => delegableCodes.has(code));
  }

  /**
   * Sprint 51.5: empleados (rol único = 'empleado') NO sub-delegan.
   * Tira ForbiddenException si el actor está en ese estado.
   *
   * Si el actor tiene rol empleado + algún otro rol (caso raro pero
   * posible), se considera no-empleado-only y se le permite.
   */
  async assertActorCanDelegate(
    db: TenantDb,
    actorUserId: string,
  ): Promise<void> {
    if (await this.isEmpleadoOnly(db, actorUserId)) {
      throw new ForbiddenException({
        message:
          'Los empleados no pueden delegar permisos — son receptores, no emisores.',
        error: 'EMPLEADO_CANNOT_DELEGATE',
      });
    }
  }

  // ────────────────────────────────────────────────────────────────────────
  // helpers privados
  // ────────────────────────────────────────────────────────────────────────

  private async isEmpleadoOnly(
    db: TenantDb,
    userId: string,
  ): Promise<boolean> {
    const rows = await db
      .select({ code: roles.code })
      .from(userRoles)
      .innerJoin(roles, eq(roles.id, userRoles.roleId))
      .where(eq(userRoles.userId, userId));
    if (rows.length === 0) return false;
    return rows.every((r) => r.code === 'empleado');
  }

  /**
   * Construye `granted_by_chain` para un nuevo override.
   *   - Si el actor tiene este permission por override 'grant', su chain
   *     se prepone (sin duplicar al actor).
   *   - Sino, chain = [actor.id].
   */
  private async buildChain(
    db: TenantDb,
    actorId: string,
    permissionCode: string,
  ): Promise<string[]> {
    const rows = await db
      .select({
        chain: userPermissionOverrides.grantedByChain,
        effect: userPermissionOverrides.effect,
      })
      .from(userPermissionOverrides)
      .where(
        and(
          eq(userPermissionOverrides.userId, actorId),
          eq(userPermissionOverrides.permissionCode, permissionCode),
        ),
      )
      .limit(1);

    const actorOverride = rows[0];
    if (actorOverride && actorOverride.effect === 'grant') {
      const base = actorOverride.chain.filter((id) => id !== actorId);
      return [...base, actorId];
    }
    return [actorId];
  }
}
