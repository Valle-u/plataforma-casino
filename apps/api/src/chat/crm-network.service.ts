/**
 * CrmNetworkService — clasifica a un usuario dentro del CRM según su RED, y
 * resuelve el ruteo/bandeja en base a eso. Fuente ÚNICA de verdad para:
 *   - a qué bandeja se ASIGNA el chat de un jugador (routing),
 *   - qué conversaciones puede VER/atender un operador (inbox + acceso),
 *   - si un operador tiene acceso al CRM (gate).
 *
 * Reglas (decisión de producto):
 *   - Red DEPENDIENTE (la del admin): la atención la maneja el admin + sus
 *     empleados. Los chats de sus jugadores van a la BANDEJA CENTRAL (admin
 *     principal). Los operadores dependientes (cajero/distribuidor/socio
 *     dependiente) NO acceden al CRM.
 *   - Red INDEPENDIENTE (socio con is_independent_branch + su bajada): cada
 *     operador atiende a sus jugadores DIRECTOS (ruteo al operador directo),
 *     como venía siendo.
 *
 * Ver docs/22-crm-livechat.md y docs/03-jerarquia-roles.md.
 */

import { Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { roles, userRoles } from '@casino/db';
import type { TenantDb } from '../tenant-resolver/tenant-context';
import { UserHierarchyService } from '../user-hierarchy/user-hierarchy.service';

export type CrmNetwork = 'central' | 'independent' | 'dependent';

/** Roles que forman el "staff central" que atiende la red dependiente. */
const CENTRAL_ROLE_CODES = ['admin_tenant', 'empleado'];

@Injectable()
export class CrmNetworkService {
  constructor(private readonly hierarchy: UserHierarchyService) {}

  private async roleCodes(db: TenantDb, userId: string): Promise<string[]> {
    const rows = await db
      .select({ code: roles.code })
      .from(userRoles)
      .innerJoin(roles, eq(roles.id, userRoles.roleId))
      .where(eq(userRoles.userId, userId));
    return rows.map((r) => r.code);
  }

  /**
   * Clasifica al usuario. Sirve tanto para OPERADORES (a qué bandeja acceden)
   * como para JUGADORES (a qué bandeja se rutean sus chats):
   *   - 'central': staff central (admin_tenant o empleado).
   *   - 'independent': está en una sub-red independiente (self o algún ancestro
   *     con is_independent_branch).
   *   - 'dependent': el resto (red del admin sin ser staff central).
   */
  async classify(db: TenantDb, userId: string): Promise<CrmNetwork> {
    const codes = await this.roleCodes(db, userId);
    if (codes.some((c) => CENTRAL_ROLE_CODES.includes(c))) return 'central';
    const indep = await this.hierarchy.getIndependentBranchAncestor(db, userId);
    return indep ? 'independent' : 'dependent';
  }

  /**
   * A qué operador se ASIGNA la conversación de un jugador:
   *   - independiente → su operador directo (parent inmediato).
   *   - dependiente → la bandeja central (admin principal).
   * (Un jugador nunca clasifica 'central'.)
   */
  async resolveAssignedOperator(
    db: TenantDb,
    playerUserId: string,
  ): Promise<string | null> {
    const net = await this.classify(db, playerUserId);
    if (net === 'independent') {
      const parent = await this.hierarchy.getActiveParent(db, playerUserId);
      return parent?.parentUserId ?? null;
    }
    return this.hierarchy.getPrimaryAdminUserId(db);
  }

  /**
   * Qué `assignedOperatorId` puede ver/atender un operador (su bandeja):
   *   - 'central' → la bandeja central (conversaciones del admin principal).
   *   - 'independent' → las suyas (self).
   *   - 'dependent' → null (SIN acceso al CRM).
   */
  async resolveInboxOwner(
    db: TenantDb,
    operatorUserId: string,
  ): Promise<string | null> {
    const net = await this.classify(db, operatorUserId);
    if (net === 'central') return this.hierarchy.getPrimaryAdminUserId(db);
    if (net === 'independent') return operatorUserId;
    return null;
  }
}
