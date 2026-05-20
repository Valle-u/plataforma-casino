/**
 * ActorRoleService — resuelve la "clase" funcional del actor (admin
 * del tenant vs socio independent vs otro) para el gating de bonuses,
 * promotions y leagues introducido en el Sprint 51.2.
 *
 * Se podría hacer ad-hoc en cada service, pero centralizar evita 3
 * implementaciones que pueden divergir. La query es barata (single
 * SELECT con dos JOINs) y se llama solo en handlers de mutación.
 *
 * No es @Global — los modules que lo usan lo importan explícito vía
 * `CommonModule`.
 */

import { Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { roles, userRoles, users } from '@casino/db';
import type { TenantDb } from '../tenant-resolver/tenant-context';

export type ActorRoleClass =
  | { kind: 'admin_tenant' }
  | { kind: 'independent_socio'; socioId: string }
  | { kind: 'other'; roleCodes: string[] };

@Injectable()
export class ActorRoleService {
  /**
   * Devuelve la clasificación del actor:
   *   - `admin_tenant`: tiene el rol admin_tenant.
   *   - `independent_socio`: tiene rol socio + flag is_independent_branch=true.
   *   - `other`: cualquier otro caso (cajero, distribuidor, socio dependiente, empleado, usuario_final).
   *
   * Si el actor no existe, devuelve `other` con roleCodes vacío (los
   * callers deciden si tirar 404/403 según contexto).
   */
  async classify(db: TenantDb, actorUserId: string): Promise<ActorRoleClass> {
    const rows = await db
      .select({
        roleCode: roles.code,
        isIndependent: users.isIndependentBranch,
      })
      .from(users)
      .leftJoin(userRoles, eq(userRoles.userId, users.id))
      .leftJoin(roles, eq(roles.id, userRoles.roleId))
      .where(eq(users.id, actorUserId));

    if (rows.length === 0) {
      return { kind: 'other', roleCodes: [] };
    }

    const roleCodes = rows
      .map((r) => r.roleCode)
      .filter((c): c is string => c !== null);

    if (roleCodes.includes('admin_tenant')) {
      return { kind: 'admin_tenant' };
    }
    if (roleCodes.includes('socio') && rows.some((r) => r.isIndependent === true)) {
      return { kind: 'independent_socio', socioId: actorUserId };
    }
    return { kind: 'other', roleCodes };
  }

  /**
   * Devuelve true si el actor es admin_tenant. Atajo para gates simples
   * (ej. promotions.create / leagues.create exclusivos del tenant).
   */
  async isAdminTenant(db: TenantDb, actorUserId: string): Promise<boolean> {
    const cls = await this.classify(db, actorUserId);
    return cls.kind === 'admin_tenant';
  }
}
