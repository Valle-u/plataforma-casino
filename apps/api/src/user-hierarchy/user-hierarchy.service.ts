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
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import {
  generateUuidV7,
  paymentMethods,
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

  /**
   * Devuelve el id del admin_tenant PRIMARIO (el más antiguo = dueño del
   * tenant) o null si no hay ninguno. Se usa para colgar a los jugadores de
   * la "casa" (registro orgánico) del admin. Si hay varios admins, gana el
   * más viejo por `created_at` (determinístico).
   */
  async getPrimaryAdminUserId(db: TenantDb): Promise<string | null> {
    const rows = await db
      .select({ id: users.id })
      .from(users)
      .innerJoin(userRoles, eq(userRoles.userId, users.id))
      .innerJoin(roles, eq(roles.id, userRoles.roleId))
      .where(eq(roles.code, 'admin_tenant'))
      .orderBy(users.createdAt)
      .limit(1);
    return rows[0]?.id ?? null;
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
    // 1. Walk UP: ancestors del usuario.
    const up = await db.execute(sql`
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
      SELECT c.uid AS operator_id, c.depth
      FROM chain c
      INNER JOIN users u ON u.id = c.uid
      WHERE u.is_independent_branch = true
      ORDER BY c.depth ASC
      LIMIT 1
    `);
    const upRows = (
      (up as unknown as { rows?: Array<{ operator_id: string }> }).rows ??
      (up as unknown as Array<{ operator_id: string }>)
    ) as Array<{ operator_id: string }>;
    if (upRows[0]) return upRows[0].operator_id;

    // 2. Walk DOWN: si el usuario está en el subárbol de una sucursal
    //    independiente (depth > 0 para excluir al propio socio).
    const down = await db.execute(sql`
      WITH RECURSIVE subtree AS (
        SELECT id AS owner_id, id AS uid, 0 AS depth
        FROM users
        WHERE is_independent_branch = true
        UNION ALL
        SELECT s.owner_id, uh.user_id AS uid, s.depth + 1
        FROM user_hierarchy uh
        INNER JOIN subtree s ON uh.parent_user_id = s.uid
        WHERE uh.until IS NULL AND s.depth < 100
      )
      SELECT owner_id
      FROM subtree
      WHERE uid = ${userId} AND depth > 0
      ORDER BY depth ASC
      LIMIT 1
    `);
    const downRows = (
      (down as unknown as { rows?: Array<{ owner_id: string }> }).rows ??
      (down as unknown as Array<{ owner_id: string }>)
    ) as Array<{ owner_id: string }>;
    if (downRows[0]) return downRows[0].owner_id;

    return null;
  }

  /**
   * Etiqueta de ORIGEN comercial para un lote de usuarios (batch). Para cada
   * `userId`, sube su cadena de ancestros y devuelve el `socio` MÁS CERCANO
   * (rol `socio`) si existe. Si no hay ningún socio en la cadena, el usuario
   * pertenece a "la Casa" (jugador directo del admin, o vía cajero/distribuidor
   * de la red central) y NO aparece en el Map.
   *
   * Se usa para etiquetar las solicitudes de depósito con su origen: "La Casa"
   * vs "Socio: <nombre>". Es DERIVADO de la jerarquía (no se persiste), así que
   * siempre queda consistente si la red cambia. Solo lectura.
   *
   * Nota de aislamiento (E8/R6/P3): en la cola del admin los jugadores de
   * sub-redes INDEPENDIENTES ya están podados aguas arriba, así que el único
   * socio que puede resolver acá para esa vista es un socio DEPENDIENTE —
   * dato que el admin sí puede ver (R6). No se filtra por rol/flag adrede:
   * el matcheo por rol `socio` es suficiente y sirve también si un operador
   * independiente mira su propia cola (resuelve a su propio socio).
   *
   * Una sola query recursiva para todo el lote (no N+1). Tope de profundidad
   * anti-ciclo.
   */
  async getSocioOriginMap(
    db: TenantDb,
    userIds: string[],
  ): Promise<
    Map<
      string,
      { socioId: string; socioUsername: string | null; socioDisplayName: string | null }
    >
  > {
    const result = new Map<
      string,
      { socioId: string; socioUsername: string | null; socioDisplayName: string | null }
    >();
    const unique = Array.from(new Set(userIds));
    if (unique.length === 0) return result;

    const idList = sql.join(
      unique.map((id) => sql`${id}`),
      sql`, `,
    );
    const raw = await db.execute(sql`
      WITH RECURSIVE chain AS (
        SELECT user_id AS player_id, user_id AS uid, parent_user_id AS parent, 0 AS depth
        FROM user_hierarchy
        WHERE user_id IN (${idList}) AND until IS NULL
        UNION ALL
        SELECT c.player_id, uh.user_id AS uid, uh.parent_user_id AS parent, c.depth + 1
        FROM user_hierarchy uh
        INNER JOIN chain c ON uh.user_id = c.parent
        WHERE uh.until IS NULL AND c.depth < 100
      )
      SELECT DISTINCT ON (c.player_id)
        c.player_id AS player_id,
        u.id AS socio_id,
        u.username AS socio_username,
        u.display_name AS socio_display_name
      FROM chain c
      INNER JOIN user_roles ur ON ur.user_id = c.uid
      INNER JOIN roles r ON r.id = ur.role_id AND r.code = 'socio'
      INNER JOIN users u ON u.id = c.uid
      WHERE c.depth >= 1
      ORDER BY c.player_id, c.depth ASC
    `);
    type OriginRow = {
      player_id: string;
      socio_id: string;
      socio_username: string | null;
      socio_display_name: string | null;
    };
    const list =
      (raw as unknown as { rows?: OriginRow[] }).rows ??
      (raw as unknown as OriginRow[]);

    for (const r of list) {
      result.set(r.player_id, {
        socioId: r.socio_id,
        socioUsername: r.socio_username,
        socioDisplayName: r.socio_display_name,
      });
    }
    return result;
  }

  /**
   * Verifica si el usuario tiene ALGUNA entrada en user_hierarchy
   * (como hijo o como padre). Útil para detectar usuarios root
   * que nunca fueron vinculados a la red.
   */
  async hasAnyEntry(db: TenantDb, userId: string): Promise<boolean> {
    const result = await db.execute(sql`
      SELECT 1
      FROM user_hierarchy
      WHERE (user_id = ${userId} OR parent_user_id = ${userId})
        AND until IS NULL
      LIMIT 1
    `);
    const rows =
      (result as unknown as { rows?: Array<unknown> }).rows ?? result;
    return rows.length > 0;
  }

  /**
   * Si hay EXACTAMENTE un usuario con is_independent_branch = true,
   * devuelve su ID. Si hay 0 o más de 1, devuelve null.
   */
  async findSingleIndependentBranch(db: TenantDb): Promise<string | null> {
    const result = await db.execute(sql`
      SELECT id
      FROM users
      WHERE is_independent_branch = true
      LIMIT 2
    `);
    const rows = (
      (result as unknown as { rows?: Array<{ id: string }> }).rows ??
      (result as unknown as Array<{ id: string }>)
    ) as Array<{ id: string }>;
    if (rows.length !== 1) return null;
    return rows[0]!.id;
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
   * IDs de los HIJOS DIRECTOS activos del user (un solo nivel, NO recursivo).
   * A diferencia de getActiveDescendants (todo el subárbol), esto devuelve solo
   * los children inmediatos — necesario para el ruteo de solicitudes al "padre
   * directo" en la red descentralizada.
   */
  async getDirectChildrenIds(
    db: TenantDb,
    parentUserId: string,
  ): Promise<string[]> {
    const rows = await db
      .select({ userId: userHierarchy.userId })
      .from(userHierarchy)
      .where(
        and(
          eq(userHierarchy.parentUserId, parentUserId),
          isNull(userHierarchy.until),
        ),
      );
    return rows.map((r) => r.userId);
  }

  /**
   * Scope para REVISAR una solicitud (aprobar/rechazar/procesar/marcar-pagado)
   * de un user dueño `ownerId`.
   *
   * Regla del modelo descentralizado (decisión del dueño 2026-07-06): si la
   * solicitud pertenece a un user de una sub-red INDEPENDIENTE, SOLO su **padre
   * directo** puede verla y aceptarla. Ni ancestros más arriba, ni el admin
   * (la red del admin es la centralizada; la independiente es un casino aparte
   * que se autogestiona nivel a nivel). El admin sí puede si resulta ser el
   * padre directo (caso del socio independiente raíz que cuelga del admin).
   *
   * Para solicitudes de la red CENTRALIZADA se mantiene la lógica previa
   * (assertScopeAllowingAdminNetwork: ancestro directo/indirecto + comodín
   * admin_network + bypass admin_tenant).
   */
  async assertCanReviewRequest(
    db: TenantDb,
    actorId: string,
    ownerId: string,
    adminNetworkBypassPerm: string,
  ): Promise<ScopeBypassInfo | null> {
    const excluded = await this.getIndependentSubtreeIds(db);
    if (excluded.has(ownerId)) {
      // Sub-red independiente → SOLO el padre directo del solicitante.
      const parent = await this.getActiveParent(db, ownerId);
      if (parent && parent.parentUserId === actorId) {
        return null; // en scope: es el padre directo. No es un bypass.
      }
      this.logger.warn(
        `INDEPENDENT_REVIEW_DENIED: actor=${actorId} owner=${ownerId} ` +
          `directParent=${parent?.parentUserId ?? 'none'} perm=${adminNetworkBypassPerm}`,
      );
      throw new OutOfScopeError(actorId, ownerId);
    }
    // Red centralizada: lógica existente sin cambios.
    return this.assertScopeAllowingAdminNetwork(
      db,
      actorId,
      ownerId,
      adminNetworkBypassPerm,
    );
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
   * Invalida el cache de permisos efectivos del `rootUserId` + TODA su sub-red.
   * Se llama tras un flip dep↔indep (branches): los 7 money-perms DINÁMICOS de
   * toda la sub-red dependen del flag `is_independent_branch` del ancestro, así
   * que un flip cambia los permisos efectivos de todos ellos al instante. Sin
   * esto, el cache (TTL ~5min) los deja stale (un cajero seguiría aprobando
   * retiros de una red que ya banca la Casa, o al revés). (2026-08-25, fix.)
   */
  async invalidateSubnetworkPermsCache(
    db: TenantDb,
    rootUserId: string,
  ): Promise<void> {
    const ids = await this.getUserIdsInSubnetwork(db, rootUserId);
    await Promise.all(
      [...ids].map((id) => this.effectivePermissions.deleteCacheForUser(id)),
    );
  }

  /**
   * Opción C (2026-08-25): como un socio puede quedar independiente SIN CBU
   * (branchBankAccount null), el aislamiento de bank_tx necesita distinguir
   * tres casos, no solo "cuenta o null":
   *   - `{ independent: false, account: null }` → admin / no-indep: sin restricción.
   *   - `{ independent: true,  account: <cbu> }` → indep con CBU: solo su cuenta.
   *   - `{ independent: true,  account: null }`  → indep SIN CBU: NO debe ver ni
   *     tocar transferencias (los callers lo BLOQUEAN / devuelven vacío). Antes
   *     este caso caía en null y se trataba como admin → fuga del extracto.
   */
  async getIndepBankScope(
    db: TenantDb,
    userId: string,
  ): Promise<{ independent: boolean; account: string | null }> {
    const rows = await db
      .select({
        acct: users.branchBankAccount,
        isIndep: users.isIndependentBranch,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    const row = rows[0];
    if (!row || !row.isIndep) return { independent: false, account: null };
    const acct = (row.acct ?? '').trim();
    return { independent: true, account: acct === '' ? null : acct };
  }

  /**
   * Aislamiento de bank_transactions por DUEÑO (2026-08-25, fix crítico). En
   * vez de filtrar por `bankAccount` (string MUTABLE que el socio controla vía
   * su método de pago — permitía reclamar el CBU del admin y ver su extracto),
   * filtramos por `uploaded_by` (INMUTABLE, seteado al subir):
   *   - socio INDEPENDIENTE → ve solo lo que subió SU sub-red
   *     (`onlyUploadedBy = getUserIdsInSubnetwork`). No depende del CBU, así que
   *     un indep sin CBU queda aislado igual (ve lo suyo, que arranca vacío).
   *   - admin / red central → ve todo MENOS lo subido por sub-redes
   *     independientes (`excludeUploadedBy = getIndependentSubtreeIds`).
   * El CBU/`branchBankAccount` pasa a ser solo metadata/display, no frontera.
   */
  async getBankTxScope(
    db: TenantDb,
    actorId: string,
  ): Promise<{ onlyUploadedBy?: string[]; excludeUploadedBy?: string[] }> {
    const { independent } = await this.getIndepBankScope(db, actorId);
    if (independent) {
      const ids = await this.getUserIdsInSubnetwork(db, actorId);
      return { onlyUploadedBy: [...ids] };
    }
    const indepIds = await this.getIndependentSubtreeIds(db);
    return { excludeUploadedBy: [...indepIds] };
  }

  /**
   * Opción C (2026-08-25): re-resuelve el CBU/alias del método de pago bancario
   * activo más reciente del socio y lo persiste en `users.branchBankAccount`.
   * Se llama cuando el socio crea/edita/archiva un método de pago (desde
   * `NodePaymentMethodsService`), para que el aislamiento de bank_tx se active
   * apenas carga su CBU tras haberse independizado sin él. Solo aplica a un
   * socio independiente (el CBU de aislamiento es suyo); en otros users es no-op.
   * Misma resolución que `BranchesService.resolveBankAccountFromPaymentMethods`
   * (cbu tiene prioridad sobre alias; el más reciente).
   */
  async syncBranchBankAccountFromPaymentMethods(
    db: TenantDb,
    ownerId: string,
  ): Promise<void> {
    const uRows = await db
      .select({ isIndep: users.isIndependentBranch })
      .from(users)
      .where(eq(users.id, ownerId))
      .limit(1);
    if (!uRows[0]?.isIndep) return; // solo el socio independiente tiene CBU de aislamiento.

    const pmRows = await db
      .select({ config: paymentMethods.config })
      .from(paymentMethods)
      .where(
        and(
          eq(paymentMethods.ownerId, ownerId),
          eq(paymentMethods.type, 'bank_transfer'),
          eq(paymentMethods.isActive, true),
        ),
      )
      .orderBy(desc(paymentMethods.createdAt))
      .limit(1);
    const config = pmRows[0]?.config as
      | { cbu?: string; alias?: string }
      | undefined;
    const value = config?.cbu?.trim() || config?.alias?.trim() || null;

    await db
      .update(users)
      .set({ branchBankAccount: value, updatedAt: new Date() })
      .where(eq(users.id, ownerId));
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

  /**
   * Red CENTRAL (para reporting de netwin por ámbito): la red del admin SIN
   * los socios dependientes ni sus sub-redes. Es decir, `getAdminNetworkIds`
   * (red centralizada) menos, por cada socio DEPENDIENTE (rol `socio`,
   * `is_independent_branch=false`), ese socio + todos sus descendientes.
   *
   * Read-only, aditivo. Semántica: "lo que opera el admin directo, sin delegar
   * a un socio dependiente". `central ⊆ dependiente ⊆ plataforma`.
   */
  async getCentralNetworkIds(db: TenantDb): Promise<Set<string>> {
    const central = await this.getAdminNetworkIds(db);
    const depSocios = await db
      .select({ id: users.id })
      .from(users)
      .innerJoin(userRoles, eq(userRoles.userId, users.id))
      .innerJoin(roles, eq(roles.id, userRoles.roleId))
      .where(
        and(eq(roles.code, 'socio'), eq(users.isIndependentBranch, false)),
      );
    for (const s of depSocios) {
      central.delete(s.id);
      const subtree = await this.getActiveDescendants(db, s.id);
      for (const d of subtree) central.delete(d);
    }
    return central;
  }

  /**
   * Full tree data for the network map visualization.
   * Returns a flat array of nodes with parent info; the frontend builds
   * the tree structure from this.
   */
  /** True si el usuario tiene el rol admin_tenant. */
  async isAdminTenant(db: TenantDb, userId: string): Promise<boolean> {
    const rows = await db
      .select({ code: roles.code })
      .from(userRoles)
      .innerJoin(roles, eq(roles.id, userRoles.roleId))
      .where(and(eq(userRoles.userId, userId), eq(roles.code, 'admin_tenant')))
      .limit(1);
    return rows.length > 0;
  }

  /**
   * Árbol para el mapa de red. Si `scopeIds` se pasa, solo devuelve esos
   * usuarios (para operadores no-admin que ven únicamente su sub-red — R2/R6).
   */
  async getFullTree(db: TenantDb, scopeIds?: Set<string>) {
    const allUsers = await db
      .select({
        id: users.id,
        username: users.username,
        displayName: users.displayName,
        status: users.status,
        isIndependentBranch: users.isIndependentBranch,
        isSystem: users.isSystem,
      })
      .from(users)
      .where(sql`${users.status} != 'banned'`);

    const activeHierarchy = await db
      .select({
        userId: userHierarchy.userId,
        parentUserId: userHierarchy.parentUserId,
        relationType: userHierarchy.relationType,
      })
      .from(userHierarchy)
      .where(isNull(userHierarchy.until));

    const userRolesData = await db
      .select({
        userId: userRoles.userId,
        roleCode: roles.code,
        roleName: roles.name,
      })
      .from(userRoles)
      .innerJoin(roles, eq(userRoles.roleId, roles.id));

    const hierarchyMap = new Map<string, { parentUserId: string | null; relationType: string }>();
    for (const h of activeHierarchy) {
      hierarchyMap.set(h.userId, { parentUserId: h.parentUserId, relationType: h.relationType });
    }

    const rolesMap = new Map<string, Array<{ code: string; name: string }>>();
    for (const r of userRolesData) {
      const list = rolesMap.get(r.userId) ?? [];
      list.push({ code: r.roleCode, name: r.roleName });
      rolesMap.set(r.userId, list);
    }

    const nodes = allUsers.map((u) => {
      const h = hierarchyMap.get(u.id);
      const userRolesList = rolesMap.get(u.id) ?? [];
      const primaryRole = userRolesList[0]?.code ?? 'usuario_final';
      return {
        id: u.id,
        username: u.username,
        displayName: u.displayName,
        status: u.status,
        isIndependentBranch: u.isIndependentBranch,
        isSystem: u.isSystem,
        parentUserId: h?.parentUserId ?? null,
        relationType: h?.relationType ?? null,
        roles: userRolesList,
        primaryRole,
      };
    });

    const scoped = scopeIds ? nodes.filter((n) => scopeIds.has(n.id)) : nodes;
    return { nodes: scoped, total: scoped.length };
  }
}
