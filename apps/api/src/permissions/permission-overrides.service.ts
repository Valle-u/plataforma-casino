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
  constructor(private readonly effective: EffectivePermissionsService) {}

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
