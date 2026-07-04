/**
 * UserHierarchyService — gestión de la red parent → child de un tenant.
 *
 * Operaciones clave:
 *   - `setParent`: asigna o cambia el parent activo de un user. Cierra
 *     la fila anterior con `until = now()` y crea una nueva con
 *     `until = NULL`. Atómico.
 *   - `clearParent`: cierra la fila activa sin abrir nueva (el user
 *     queda sin parent — root).
 *   - `getActiveParent`: lee el parent actual.
 *   - `getActiveAncestors`: lista todos los ancestros vía recursión SQL.
 *   - `getActiveDescendants`: lista toda la red bajo un user.
 *   - `isAncestorOf`: verifica si ancestor está en la chain de descendant.
 *
 * Anti-ciclo: antes de setear un parent, verificamos que el nuevo parent
 * NO sea un descendant del user. Sino crearíamos circular A→B y B→A.
 *
 * Self-parent rechazado explícitamente.
 *
 * Histórico: las filas viejas (con `until` no NULL) NUNCA se borran.
 * Se pueden consultar para reconstruir relaciones del pasado.
 */

import { Injectable, Logger } from '@nestjs/common';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import {
  generateUuidV7,
  roles,
  userHierarchy,
  userRoles,
  users,
  type UserHierarchy,
} from '@casino/db';
import { EffectivePermissionsService } from '../permissions/effective-permissions.service';
import type { TenantDb } from '../tenant-resolver/tenant-context';
import type { ScopeBypassInfo } from './admin-network-bypass.decorator';
import {
  HierarchyCycleError,
  OutOfScopeError,
  SelfParentError,
} from './user-hierarchy.errors';

export interface SetParentParams {
  userId: string;
  parentUserId: string;
  relationType: string;
  actorUserId: string;
}

@Injectable()
export class UserHierarchyService {
  private readonly logger = new Logger(UserHierarchyService.name);

  constructor(
    private readonly effectivePermissions: EffectivePermissionsService,
  ) {}

  /**
   * Asigna o cambia el parent activo del user. Cierra la fila anterior
   * (si existía) e inserta una nueva. Todo dentro de TX postgres.
   */
  async setParent(db: TenantDb, params: SetParentParams): Promise<UserHierarchy> {
    if (params.userId === params.parentUserId) {
      throw new SelfParentError();
    }

    // Anti-ciclo: el nuevo parent NO debe estar entre los descendants
    // actuales del user. Si lo está, asignarlo crearía un ciclo.
    const wouldCycle = await this.isAncestorOf(db, params.userId, params.parentUserId);
    if (wouldCycle) {
      throw new HierarchyCycleError(params.userId, params.parentUserId);
    }

    return db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL lock_timeout = '5s'`);

      // Cerrar fila activa anterior, si existe.
      await tx
        .update(userHierarchy)
        .set({ until: new Date() })
        .where(
          and(
            eq(userHierarchy.userId, params.userId),
            isNull(userHierarchy.until),
          ),
        );

      // Insertar nueva fila activa.
      const inserted = await tx
        .insert(userHierarchy)
        .values({
          id: generateUuidV7(),
          userId: params.userId,
          parentUserId: params.parentUserId,
          relationType: params.relationType,
          createdBy: params.actorUserId,
        })
        .returning();
      return inserted[0]!;
    });
  }

  /**
   * Cierra el parent activo del user sin abrir uno nuevo. El user queda
   * como "root". Idempotente: si ya no tenía parent activo, no hace nada.
   */
  async clearParent(db: TenantDb, userId: string): Promise<void> {
    await db
      .update(userHierarchy)
      .set({ until: new Date() })
      .where(and(eq(userHierarchy.userId, userId), isNull(userHierarchy.until)));
  }

  /** Devuelve la fila activa de hierarchy del user, o null si no tiene. */
  async getActiveParent(db: TenantDb, userId: string): Promise<UserHierarchy | null> {
    const rows = await db
      .select()
      .from(userHierarchy)
      .where(and(eq(userHierarchy.userId, userId), isNull(userHierarchy.until)))
      .limit(1);
    return rows[0] ?? null;
  }

  /**
   * Devuelve los IDs de TODOS los ancestros activos del user (parent,
   * grandparent, etc.) usando WITH RECURSIVE.
   */
  async getActiveAncestors(db: TenantDb, userId: string): Promise<string[]> {
    const result = await db.execute(sql`
      WITH RECURSIVE ancestors AS (
        SELECT parent_user_id
        FROM user_hierarchy
        WHERE user_id = ${userId} AND until IS NULL AND parent_user_id IS NOT NULL
        UNION
        SELECT uh.parent_user_id
        FROM user_hierarchy uh
        INNER JOIN ancestors a ON uh.user_id = a.parent_user_id
        WHERE uh.until IS NULL AND uh.parent_user_id IS NOT NULL
      )
      SELECT parent_user_id FROM ancestors
    `);
    const rows = ((result as unknown as { rows?: Array<{ parent_user_id: string }> }).rows ??
      (result as unknown as Array<{ parent_user_id: string }>)) as Array<{
      parent_user_id: string;
    }>;
    return rows.map((r) => r.parent_user_id);
  }

  /**
   * Devuelve los IDs de TODOS los descendants activos del user (children,
   * grandchildren, etc.). BFS recursivo via SQL.
   */
  async getActiveDescendants(db: TenantDb, parentUserId: string): Promise<string[]> {
    const result = await db.execute(sql`
      WITH RECURSIVE descendants AS (
        SELECT user_id
        FROM user_hierarchy
        WHERE parent_user_id = ${parentUserId} AND until IS NULL
        UNION
        SELECT uh.user_id
        FROM user_hierarchy uh
        INNER JOIN descendants d ON uh.parent_user_id = d.user_id
        WHERE uh.until IS NULL
      )
      SELECT user_id FROM descendants
    `);
    const rows = ((result as unknown as { rows?: Array<{ user_id: string }> }).rows ??
      (result as unknown as Array<{ user_id: string }>)) as Array<{ user_id: string }>;
    return rows.map((r) => r.user_id);
  }

  /**
   * True si `ancestorId` es ancestor activo (directo o indirecto) de
   * `descendantId`. False si no hay relación o si descendantId === ancestorId.
   */
  async isAncestorOf(
    db: TenantDb,
    ancestorId: string,
    descendantId: string,
  ): Promise<boolean> {
    if (ancestorId === descendantId) return false;
    const ancestors = await this.getActiveAncestors(db, descendantId);
    return ancestors.includes(ancestorId);
  }

  /**
   * Sprint 51.2: sube la cadena de ancestors buscando un socio con
   * `is_independent_branch=true`. Si lo encuentra devuelve su userId;
   * sino devuelve `null`.
   *
   * Sirve para "este player ¿cuelga de una sucursal independiente?" — clave
   * para gating de bonos automáticos y promotions/leagues. Reutiliza
   * `getActiveAncestors` y filtra por role='socio' + flag.
   *
   * Si el propio `userId` es un socio independent, también devuelve su
   * id (consideramos a la sucursal como ancestor de sí misma a fines de
   * scope — si el admin del tenant intenta otorgar bono al socio, también
   * cae en el "cross-branch" check).
   */
  async getIndependentBranchAncestor(
    db: TenantDb,
    userId: string,
  ): Promise<string | null> {
    // Self-check primero.
    const selfRows = await db
      .select({
        id: users.id,
        isIndependent: users.isIndependentBranch,
        role: roles.code,
      })
      .from(users)
      .leftJoin(userRoles, eq(userRoles.userId, users.id))
      .leftJoin(roles, eq(roles.id, userRoles.roleId))
      .where(eq(users.id, userId));
    const isSelfIndependentSocio = selfRows.some(
      (r) => r.role === 'socio' && r.isIndependent === true,
    );
    if (isSelfIndependentSocio) return userId;

    // Walk up.
    const ancestors = await this.getActiveAncestors(db, userId);
    if (ancestors.length === 0) return null;

    const rows = await db
      .select({
        id: users.id,
        isIndependent: users.isIndependentBranch,
      })
      .from(users)
      .innerJoin(userRoles, eq(userRoles.userId, users.id))
      .innerJoin(roles, eq(roles.id, userRoles.roleId))
      .where(
        and(
          inArray(users.id, ancestors),
          eq(roles.code, 'socio'),
          eq(users.isIndependentBranch, true),
        ),
      );
    return rows[0]?.id ?? null;
  }

  /**
   * Sube la cadena de ancestros ESTRICTOS (excluye al propio `userId`) y
   * devuelve el `is_independent_branch=true` MÁS CERCANO, o `null` si el
   * jugador no cuelga de ninguna sucursal independiente.
   *
   * A diferencia de `getIndependentBranchAncestor` (self-inclusive y sin
   * orden de cercanía — pensado para scope de bonos), este resuelve la "casa"
   * que BANCA el juego de un jugador: debe ser un operador ESTRICTAMENTE por
   * encima, y si hay independientes anidados, gana el más cercano. Filtra por
   * el flag SIN importar el rol (mismo criterio que la poda de comisiones: un
   * flag mal puesto igual rutea consistente). Tope de profundidad anti-ciclo.
   */
  async getNearestIndependentBranchAncestor(
    db: TenantDb,
    userId: string,
  ): Promise<string | null> {
    const result = await db.execute(sql`
      WITH RECURSIVE chain AS (
        SELECT parent_user_id AS uid, 1 AS depth
        FROM user_hierarchy
        WHERE user_id = ${userId} AND until IS NULL AND parent_user_id IS NOT NULL
        UNION ALL
        SELECT uh.parent_user_id AS uid, c.depth + 1
        FROM user_hierarchy uh
        INNER JOIN chain c ON uh.user_id = c.uid
        WHERE uh.until IS NULL AND uh.parent_user_id IS NOT NULL AND c.depth < 100
      )
      SELECT c.uid AS operator_id
      FROM chain c
      INNER JOIN users u ON u.id = c.uid
      WHERE u.is_independent_branch = true
      ORDER BY c.depth ASC
      LIMIT 1
    `);
    const rows = ((result as unknown as { rows?: Array<{ operator_id: string }> })
      .rows ??
      (result as unknown as Array<{ operator_id: string }>)) as Array<{
      operator_id: string;
    }>;
    return rows[0]?.operator_id ?? null;
  }

  /**
   * Valida que `actorId` puede operar sobre `targetUserId` según la
   * misma política que el ScopeGuard (3 bypasses: self, admin_tenant,
   * descendant). Útil para handlers que tienen el target en una entity
   * intermedia (deposit.userId, withdrawal.userId, etc.) y no pueden
   * usar el guard declarativo.
   *
   * Tira `OutOfScopeError` si no aplica ninguno de los 3 caminos.
   */
  async assertScope(db: TenantDb, actorId: string, targetUserId: string): Promise<void> {
    if (actorId === targetUserId) return;

    // Bypass admin_tenant.
    const adminRows = await db
      .select({ code: roles.code })
      .from(userRoles)
      .innerJoin(roles, eq(roles.id, userRoles.roleId))
      .where(and(eq(userRoles.userId, actorId), inArray(roles.code, ['admin_tenant'])))
      .limit(1);
    if (adminRows.length > 0) return;

    // En red del actor.
    const isInNetwork = await this.isAncestorOf(db, actorId, targetUserId);
    if (isInNetwork) return;

    throw new OutOfScopeError(actorId, targetUserId);
  }

  /**
   * Como assertScope, pero acepta el bypass admin_network (comodín externo):
   * si el actor tiene `adminNetworkBypassPerm` y el target ∈ red del admin,
   * deja pasar y retorna `{kind:'admin_network', perm}` para que el caller
   * lo registre en audit.
   *
   * - Retorna `null` si pasó por el camino normal (self / admin_tenant / red).
   * - Retorna `ScopeBypassInfo` si pasó por el bypass admin_network.
   * - Tira `OutOfScopeError` si ninguno aplica.
   *
   * Usar desde controllers que hacen scope check manual sobre user_id
   * resuelto desde una entidad intermedia (deposits.approve, withdrawals.*,
   * bonuses.cancel/force-clear).
   */
  async assertScopeAllowingAdminNetwork(
    db: TenantDb,
    actorId: string,
    targetUserId: string,
    adminNetworkBypassPerm: string,
  ): Promise<ScopeBypassInfo | null> {
    if (actorId === targetUserId) return null;

    // Bypass admin_tenant.
    const adminRows = await db
      .select({ code: roles.code })
      .from(userRoles)
      .innerJoin(roles, eq(roles.id, userRoles.roleId))
      .where(and(eq(userRoles.userId, actorId), inArray(roles.code, ['admin_tenant'])))
      .limit(1);
    if (adminRows.length > 0) return null;

    // En red del actor.
    const isInNetwork = await this.isAncestorOf(db, actorId, targetUserId);
    if (isInNetwork) return null;

    // Bypass admin_network (comodín externo): requiere que el actor tenga el
    // permiso Y **el actor esté dentro de la red del admin** Y el target
    // también esté en la red del admin (excluye sub-red indep).
    //
    // El chequeo del actor es CRÍTICO: sin él, un socio independiente al que
    // se le otorgue el comodín *_admin_network puede cruzar hacia la red del
    // admin y ejecutar acciones que nunca debía tocar (drenar Casa vía
    // correcciones, subir cupos, etc.). El comodín está diseñado para
    // usuarios del admin_network que operan sobre el admin_network — nunca
    // para escalar desde una sub-red indep hacia el admin. Mismo pattern que
    // ScopeGuard.canActivate (bypass 3).
    const hasPerm = await this.effectivePermissions.hasAllPermissions(
      db,
      actorId,
      [adminNetworkBypassPerm],
    );
    if (hasPerm) {
      const adminNetworkIds = await this.getAdminNetworkIds(db);
      const actorInAdminNetwork = adminNetworkIds.has(actorId);
      const targetInAdminNetwork = adminNetworkIds.has(targetUserId);
      if (actorInAdminNetwork && targetInAdminNetwork) {
        this.logger.log(
          `SCOPE_BYPASS_ADMIN_NETWORK: actor=${actorId} target=${targetUserId} perm=${adminNetworkBypassPerm}`,
        );
        return { kind: 'admin_network', perm: adminNetworkBypassPerm };
      }
      if (!actorInAdminNetwork && targetInAdminNetwork) {
        // Log severity alta: alguien fuera del admin_network intentó usar
        // el comodín para tocar el admin_network. Puerta de exploit
        // conocida (D1 pre-fix). No dejar pasar.
        this.logger.warn(
          `SCOPE_BYPASS_REJECTED_ACTOR_OUTSIDE_ADMIN_NETWORK: actor=${actorId} target=${targetUserId} perm=${adminNetworkBypassPerm}`,
        );
      }
    }

    throw new OutOfScopeError(actorId, targetUserId);
  }

  /**
   * IDs de todos los socios independientes + su subárbol completo (recursivo).
   * Sirve para PODAR la sub-red del independiente del scope del admin en
   * cualquier listado (usuarios, depósitos, retiros, bank-txs, bonos, etc.).
   *
   * El modelo económico define que la sub-red del socio independiente es un
   * "casino separado" dentro del tenant: el admin no debería verla en las
   * colas de solicitudes ni operar sobre ella.
   *
   * Patrón inspirado en NetworkCommissionsService.computePeriod (mismo BFS
   * descendente para poda por is_independent_branch). Idempotente y O(N)
   * sobre la cantidad de independientes y sus descendants.
   */
  /**
   * Cuentas bancarias propias (`branchBankAccount`) de todos los socios
   * marcados como independientes. Sirve para excluir del listado del admin
   * las bank_transactions que caen en el banco propio del socio: el
   * independiente tiene su banco, ese extracto no le corresponde al admin.
   *
   * Devuelve solo cuentas no-vacías (los socios sin cuenta configurada no
   * generan filtro; sus bank_txs seguirían viéndose, pero como el
   * independiente exige `branchBankAccount` al activarse, no es el caso
   * habitual).
   */
  async getIndependentBankAccounts(db: TenantDb): Promise<string[]> {
    const rows = await db
      .select({ acct: users.branchBankAccount })
      .from(users)
      .where(eq(users.isIndependentBranch, true));
    const seen = new Set<string>();
    for (const r of rows) {
      if (r.acct && r.acct.trim() !== '') seen.add(r.acct.trim());
    }
    return Array.from(seen);
  }

  /**
   * Capa 3 · Fase 3: sub-red del socio para el filtrado de fraud.
   * Semántica: owner + todos sus descendants recursivos.
   *
   * Consumers principales: fraud.service (list/get/confirm/dismiss),
   * bonuses.grant_manual (validación de scope), etc. Igual definición
   * que getActiveDescendants pero incluyendo al propio root.
   */
  async getUserIdsInSubnetwork(
    db: TenantDb,
    ownerUserId: string,
  ): Promise<Set<string>> {
    const descendants = await this.getActiveDescendants(db, ownerUserId);
    return new Set([ownerUserId, ...descendants]);
  }

  /**
   * Capa 3 · Fase 2: devuelve la cuenta bancaria propia del user si es
   * socio independiente (`isIndependentBranch=true`). Sino null.
   *
   * El toggleIndependence exige que branchBankAccount venga seteada, así
   * que en la práctica nunca devuelve string vacío cuando el flag es true
   * (la validación de docs/17 lo garantiza).
   */
  async getBankAccountOfIndependent(
    db: TenantDb,
    userId: string,
  ): Promise<string | null> {
    const rows = await db
      .select({
        acct: users.branchBankAccount,
        isIndep: users.isIndependentBranch,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    const row = rows[0];
    if (!row || !row.isIndep) return null;
    const acct = (row.acct ?? '').trim();
    return acct === '' ? null : acct;
  }

  async getIndependentSubtreeIds(db: TenantDb): Promise<Set<string>> {
    const independents = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.isIndependentBranch, true));
    if (independents.length === 0) return new Set();

    const excluded = new Set<string>();
    for (const { id } of independents) {
      if (excluded.has(id)) continue;
      excluded.add(id);
      const subtree = await this.getActiveDescendants(db, id);
      for (const d of subtree) excluded.add(d);
    }
    return excluded;
  }

  /**
   * Red del admin: TODOS los users del tenant MENOS la sub-red del socio
   * independiente (socios independientes + todos sus descendants).
   *
   * Consumer principal: ScopeGuard cuando el actor tiene un permiso
   * `*_admin_network` (comodín externo). Devuelve el whitelist positivo
   * al que ese actor puede apuntar.
   */
  async getAdminNetworkIds(db: TenantDb): Promise<Set<string>> {
    const rows = await db.select({ id: users.id }).from(users);
    const excluded = await this.getIndependentSubtreeIds(db);
    const result = new Set<string>();
    for (const r of rows) {
      if (!excluded.has(r.id)) result.add(r.id);
    }
    return result;
  }
}
