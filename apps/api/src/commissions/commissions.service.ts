/**
 * CommissionsService — config de comisiones por red (modelo socios-only).
 *
 * El modelo viejo (reglas globales por rol + comisión sobre el depósito) se
 * eliminó por completo. Queda solo `setNetworkRate`: el admin fija el % que un
 * socio gana de la NetWin de su red. El cómputo y la liquidación viven en
 * `NetworkCommissionsService`.
 */

import { Injectable } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import { roles, userHierarchy, userRoles, users } from '@casino/db';
import type { TenantDb } from '../tenant-resolver/tenant-context';
import { UserHierarchyService } from '../user-hierarchy/user-hierarchy.service';
import {
  InvalidNetworkRateError,
  NetworkRateBelowChildrenError,
  NetworkRateExceedsParentError,
  NotDirectChildError,
} from './commissions.errors';

@Injectable()
export class CommissionsService {
  constructor(private readonly hierarchy: UserHierarchyService) {}

  private async isAdminTenant(db: TenantDb, userId: string): Promise<boolean> {
    const rows = await db
      .select({ code: roles.code })
      .from(userRoles)
      .innerJoin(roles, eq(roles.id, userRoles.roleId))
      .where(and(eq(userRoles.userId, userId), eq(roles.code, 'admin_tenant')))
      .limit(1);
    return rows.length > 0;
  }

  /**
   * Fija la comisión (%) que un socio (hijo directo del admin) gana de la NetWin
   * de su red. Reglas:
   *   - rate en [0, 100].
   *   - El que la fija debe ser el PADRE DIRECTO (el admin fija a los socios).
   *   - Tope: rate ≤ lo que el actor cobra de su propio padre (markup sano;
   *     para el admin el tope es 100), y rate ≥ el % de cualquier hijo activo
   *     (no se puede cobrar menos de lo que ya se le paga a un hijo).
   */
  async setNetworkRate(
    db: TenantDb,
    params: { actorUserId: string; childUserId: string; rate: number },
  ): Promise<void> {
    const { actorUserId, childUserId, rate } = params;
    if (!Number.isFinite(rate) || rate < 0 || rate > 100) {
      throw new InvalidNetworkRateError(rate);
    }

    const actorIsAdmin = await this.isAdminTenant(db, actorUserId);
    const childParent = await this.hierarchy.getActiveParent(db, childUserId);

    let cap: number;
    if (actorIsAdmin) {
      const topLevel =
        !childParent ||
        childParent.parentUserId === null ||
        childParent.parentUserId === actorUserId;
      if (!topLevel) throw new NotDirectChildError();
      cap = 100;
    } else {
      if (!childParent || childParent.parentUserId !== actorUserId) {
        throw new NotDirectChildError();
      }
      const actorRows = await db
        .select({ rate: users.commissionRate })
        .from(users)
        .where(eq(users.id, actorUserId))
        .limit(1);
      cap = Number(actorRows[0]?.rate ?? 0);
    }

    if (rate > cap) throw new NetworkRateExceedsParentError(rate, cap);

    // Markup BIDIRECCIONAL: el nodo no puede cobrar menos de lo que ya le paga
    // a alguno de sus hijos activos.
    const childRates = await db
      .select({ rate: users.commissionRate })
      .from(userHierarchy)
      .innerJoin(users, eq(users.id, userHierarchy.userId))
      .where(
        and(
          eq(userHierarchy.parentUserId, childUserId),
          isNull(userHierarchy.until),
        ),
      );
    let maxChildRate = 0;
    for (const r of childRates) maxChildRate = Math.max(maxChildRate, Number(r.rate));
    if (rate < maxChildRate) {
      throw new NetworkRateBelowChildrenError(rate, maxChildRate);
    }

    await db
      .update(users)
      .set({ commissionRate: rate.toFixed(2), updatedAt: new Date() })
      .where(eq(users.id, childUserId));
  }
}
