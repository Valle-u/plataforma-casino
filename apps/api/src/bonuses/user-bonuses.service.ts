/**
 * UserBonusesService — instancias de bono asignadas a usuarios.
 *
 * Operaciones:
 *   - `grantManual(actorId, dto)`: cajero/admin otorga un bono. Debita
 *     el wallet del funder (balance) Y credita el bonus_balance del
 *     jugador. Crea `user_bonus` con status='active' para trazabilidad.
 *     Idempotente via `grantIdempotencyKey`.
 *   - `listForUser(userId, filters)`: bonos de un user.
 *   - `findById(id)`.
 *
 * Diseño:
 *   - Toda mutación corre en TX. El wallet primitive `executeTransaction`
 *     ya gestiona FOR UPDATE + idempotency-check.
 *   - `executeBonusFunding` debita al funder (balance).
 *   - `creditBonusBalance` credita al jugador (bonus_balance).
 *   - Ambas operaciones dentro de un db.transaction() para atomicidad.
 *   - Se crea registro `user_bonus` para trazabilidad, pero NO hay
 *     lifecycle (pending/cleared/cancelled). Las fichas de bono se
 *     consumen directamente al apostar con `placeBetWithBonus`.
 */

import { Injectable } from '@nestjs/common';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import {
  bonusDefinitions,
  users,
  userBonuses,
  type BonusDefinition,
  type NewUserBonus,
  type UserBonus,
} from '@casino/db';
import { ActorRoleService } from '../common/actor-role.service';
import { isUniqueViolation } from '../common/pg-error';
import type { TenantDb } from '../tenant-resolver/tenant-context';
import { UserHierarchyService } from '../user-hierarchy/user-hierarchy.service';
import { WalletService } from '../wallet/wallet.service';
import {
  BonusActorRoleError,
  BonusDefinitionNotActiveError,
  BonusDefinitionNotFoundError,
  BonusOutOfBranchScopeError,
  BonusTargetNotFoundError,
  FunderInsufficientBalanceError,
  GrantIdempotencyConflictError,
  UserBonusNotFoundError,
} from './bonuses.errors';
import {
  IdempotencyConflictError,
  InsufficientBalanceError,
} from '../wallet/wallet.errors';

export interface GrantManualParams {
  actorUserId: string;
  /** Target user (recibe el bono). */
  userId: string;
  definitionId: string;
  amount: string;
  reason: string;
  grantIdempotencyKey: string;
  notes?: string | null;
  sourceEvent?: Record<string, unknown>;
  /**
   * Sprint 51.2: si `true`, saltea el check de rol del actor. Pensado
   * SOLO para grants automáticos del sistema (BonusesAutoGrantService),
   * donde el actor es el cajero que aprobó el deposit pero el "owner"
   * semántico del bono es admin_tenant o socio independent (depende
   * de la definition pre-seleccionada). El target/owner scope check
   * sigue aplicando — no es bypass total.
   */
  skipActorRoleCheck?: boolean;
}

export interface GrantManualResult {
  bonus: UserBonus;
  independentBranchSocioId: string | null;
}

/**
 * UserBonus + campos enriquecidos via JOIN con users + bonus_definitions.
 * Lo usa el list global del panel admin para mostrar nombres legibles.
 */
export interface UserBonusWithRelations extends UserBonus {
  userUsername: string | null;
  userDisplayName: string | null;
  definitionCode: string | null;
  definitionName: string | null;
  definitionType: string | null;
}

@Injectable()
export class UserBonusesService {

  constructor(
    private readonly walletService: WalletService,
    private readonly actorRole: ActorRoleService,
    private readonly hierarchy: UserHierarchyService,
  ) {}

  /**
   * Valida que el target user es compatible con la definition que se va
   * a otorgar. NO valida el actor (eso lo hace `assertActorAllowed`).
   *
   * Reglas:
   *   - Definition owner = admin_tenant: target NO puede estar bajo un
   *     socio independent. Si lo está, tira BonusOutOfBranchScopeError.
   *   - Definition owner = independent_socio S: target DEBE estar bajo S
   *     (inclusive S mismo). Sino tira BonusOutOfBranchScopeError.
   *
   * Devuelve el socioId dueño de la rama independent para audit.
   */
  private async assertTargetMatchesOwner(
    db: TenantDb,
    targetUserId: string,
    definition: BonusDefinition,
  ): Promise<string | null> {
    const defOwner = await this.actorRole.classify(db, definition.createdByUserId);

    if (defOwner.kind === 'admin_tenant') {
      const branch = await this.hierarchy.getIndependentBranchAncestor(
        db,
        targetUserId,
      );
      if (branch !== null) {
        throw new BonusOutOfBranchScopeError(definition.createdByUserId, targetUserId);
      }
      return null;
    }

    if (defOwner.kind === 'independent_socio') {
      if (targetUserId !== defOwner.socioId) {
        const isDescendant = await this.hierarchy.isAncestorOf(
          db,
          defOwner.socioId,
          targetUserId,
        );
        if (!isDescendant) {
          throw new BonusOutOfBranchScopeError(defOwner.socioId, targetUserId);
        }
      }
      return defOwner.socioId;
    }

    return null;
  }

  /**
   * Sprint 51.2: valida que el actor humano puede usar una definition.
   *   - admin_tenant: solo definitions de owner=admin_tenant.
   *   - independent_socio S: solo definitions de owner=S.
   *   - otros roles: 403.
   *
   * El auto-grant del sistema NO llama este check (lo bypassea porque
   * el caller es el cajero que aprobó deposit, no el "owner" semántico
   * del bono).
   */
  private async assertActorAllowed(
    db: TenantDb,
    actorUserId: string,
    definition: BonusDefinition,
  ): Promise<void> {
    const actor = await this.actorRole.classify(db, actorUserId);
    if (actor.kind === 'other') {
      throw new BonusActorRoleError(actorUserId);
    }
    const defOwner = await this.actorRole.classify(db, definition.createdByUserId);

    if (actor.kind === 'admin_tenant' && defOwner.kind !== 'admin_tenant') {
      throw new BonusActorRoleError(actorUserId);
    }
    if (
      actor.kind === 'independent_socio' &&
      (defOwner.kind !== 'independent_socio' || defOwner.socioId !== actor.socioId)
    ) {
      throw new BonusActorRoleError(actorUserId);
    }
  }

  // ──────────────────────────────────────────────────────────────────────
  // Grant manual — credit bonus_balance directly (dual wallet)
  // ──────────────────────────────────────────────────────────────────────
  async grantManual(db: TenantDb, params: GrantManualParams): Promise<GrantManualResult> {
    // 1. Idempotency check rápido (la UNIQUE index también lo enforce; este
    //    es el path optimista para devolver el existing antes de fallar).
    const existing = await db
      .select()
      .from(userBonuses)
      .where(eq(userBonuses.grantIdempotencyKey, params.grantIdempotencyKey))
      .limit(1);
    if (existing[0]) {
      const sameParams =
        existing[0].userId === params.userId &&
        existing[0].definitionId === params.definitionId &&
        this.toCents(existing[0].grantedAmount) === this.toCents(params.amount);
      if (!sameParams) {
        throw new GrantIdempotencyConflictError(params.grantIdempotencyKey);
      }
      const branch = await this.hierarchy.getIndependentBranchAncestor(
        db,
        existing[0].userId,
      );
      return {
        bonus: existing[0],
        independentBranchSocioId: branch,
      };
    }

    // 2. Validar target user.
    const targetRow = await db
      .select()
      .from(users)
      .where(eq(users.id, params.userId))
      .limit(1);
    if (!targetRow[0]) throw new BonusTargetNotFoundError(params.userId);

    // 3. Cargar la definition + validar status.
    const defRow = await db
      .select()
      .from(bonusDefinitions)
      .where(eq(bonusDefinitions.id, params.definitionId))
      .limit(1);
    const def = defRow[0];
    if (!def) throw new BonusDefinitionNotFoundError(params.definitionId);
    if (def.status !== 'active') {
      throw new BonusDefinitionNotActiveError(def.id, def.status);
    }

    // 3.5: scope check (actor + target vs definition owner).
    if (!params.skipActorRoleCheck) {
      await this.assertActorAllowed(db, params.actorUserId, def);
    }
    const scope = await this.assertTargetMatchesOwner(db, params.userId, def);

    // 4. Atomic: debit funder + credit player's bonus_balance + insert user_bonus.
    //    Both wallet operations happen inside the same db.transaction() for
    //    atomicity (savepoints for each nested db.transaction call).
    const funderWallet = await this.walletService.getOrCreateWalletForUser(
      db,
      def.fundedByUserId,
    );
    const playerWallet = await this.walletService.getOrCreateWalletForUser(
      db,
      params.userId,
    );

    let fundingTxId = '';

    try {
      // Execute both wallet operations inside a single outer TX.
      // executeBonusFunding and creditBonusBalance each create their own
      // nested db.transaction() → becomes savepoints inside this outer TX.
      // If either fails, both roll back atomically.
      await db.transaction(async (tx) => {
        const fTx = await this.walletService.executeBonusFunding(tx as unknown as TenantDb, {
          walletId: funderWallet.id,
          amount: params.amount,
          idempotencyKey: `bonus_grant:${params.grantIdempotencyKey}`,
          actorUserId: params.actorUserId,
          reason: `Funding bono ${def.code}`,
          counterpartyUserId: params.userId,
        });
        fundingTxId = fTx.id;

        await this.walletService.creditBonusBalance(tx as unknown as TenantDb, {
          walletId: playerWallet.id,
          amount: params.amount,
          idempotencyKey: `bonus_credit:${params.grantIdempotencyKey}`,
          actorUserId: params.actorUserId,
          reason: `Bono "${def.name}" (${def.code})`,
          referenceId: null,
          relatedTxId: fTx.id,
        });
      });
    } catch (err) {
      if (err instanceof InsufficientBalanceError) {
        throw new FunderInsufficientBalanceError(
          def.fundedByUserId,
          params.amount,
          err.available,
        );
      }
      if (err instanceof IdempotencyConflictError) {
        throw new GrantIdempotencyConflictError(params.grantIdempotencyKey);
      }
      throw err;
    }

    // 5. Crear el user_bonus row (para trazabilidad, no para lifecycle).
    const expiresAt = new Date(Date.now() + def.expirationDays * 24 * 60 * 60 * 1000);
    const newRow: NewUserBonus = {
      userId: params.userId,
      definitionId: def.id,
      grantedAmount: params.amount,
      remainingAmount: params.amount,
      status: 'active',
      fundedByUserId: def.fundedByUserId,
      grantedByUserId: params.actorUserId,
      grantIdempotencyKey: params.grantIdempotencyKey,
      fundingTxId,
      reason: params.reason,
      sourceEvent: params.sourceEvent ?? { kind: 'manual' },
      expiresAt,
      activatedAt: new Date(),
    };

    try {
      const inserted = await db.insert(userBonuses).values(newRow).returning();
      return {
        bonus: inserted[0]!,
        independentBranchSocioId: scope,
      };
    } catch (err: unknown) {
      if (isUniqueViolation(err)) {
        const re = await db
          .select()
          .from(userBonuses)
          .where(eq(userBonuses.grantIdempotencyKey, params.grantIdempotencyKey))
          .limit(1);
        if (re[0]) {
          return {
            bonus: re[0],
            independentBranchSocioId: scope,
          };
        }
      }
      throw err;
    }
  }

  // ──────────────────────────────────────────────────────────────────────
  // Listings
  // ──────────────────────────────────────────────────────────────────────
  async findById(db: TenantDb, id: string): Promise<UserBonus> {
    const rows = await db
      .select()
      .from(userBonuses)
      .where(eq(userBonuses.id, id))
      .limit(1);
    if (!rows[0]) throw new UserBonusNotFoundError(id);
    return rows[0];
  }

  /**
   * Busca un user_bonus por grant idempotency key. Util para detectar
   * "ya existía" sin lanzar excepción — útil en flujos auto-grant
   * (cashback, welcome) donde el caller quiere saber si fue creación
   * fresh vs idempotency-hit.
   */
  async findByGrantKey(db: TenantDb, key: string): Promise<UserBonus | null> {
    const rows = await db
      .select()
      .from(userBonuses)
      .where(eq(userBonuses.grantIdempotencyKey, key))
      .limit(1);
    return rows[0] ?? null;
  }

  async listForUser(
    db: TenantDb,
    userId: string,
    filters: { statuses?: string[]; limit?: number; offset?: number } = {},
  ): Promise<{ data: UserBonusWithRelations[]; total: number }> {
    const conditions = [eq(userBonuses.userId, userId)];
    if (filters.statuses && filters.statuses.length > 0) {
      conditions.push(
        inArray(
          userBonuses.status,
          filters.statuses as Array<UserBonus['status']>,
        ),
      );
    }
    const whereExpr = and(...conditions);

    const limit = filters.limit ?? 50;
    const offset = filters.offset ?? 0;

    // Sprint: el endpoint /me ahora enriquece con nombre/tipo/código de la
    // definición (LEFT JOIN), igual que listAll — antes devolvía solo los
    // campos de user_bonuses y el cliente caía a "Bono".
    const rows = await db
      .select({
        bonus: userBonuses,
        userUsername: users.username,
        userDisplayName: users.displayName,
        definitionCode: bonusDefinitions.code,
        definitionName: bonusDefinitions.name,
        definitionType: bonusDefinitions.type,
      })
      .from(userBonuses)
      .leftJoin(users, eq(users.id, userBonuses.userId))
      .leftJoin(
        bonusDefinitions,
        eq(bonusDefinitions.id, userBonuses.definitionId),
      )
      .where(whereExpr)
      .orderBy(desc(userBonuses.grantedAt))
      .limit(limit)
      .offset(offset);

    const data: UserBonusWithRelations[] = rows.map((r) => ({
      ...r.bonus,
      userUsername: r.userUsername,
      userDisplayName: r.userDisplayName,
      definitionCode: r.definitionCode,
      definitionName: r.definitionName,
      definitionType: r.definitionType,
    }));

    const totalResult = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(userBonuses)
      .where(whereExpr);
    const total = totalResult[0]?.count ?? 0;

    return { data, total };
  }

  /**
   * Lista TODOS los bonos del tenant con filtros opcionales (status,
   * userId, definitionId). LEFT JOIN con users + bonus_definitions para
   * devolver labels enriquecidos para la tabla del panel admin.
   *
   * Backwards-compat: devuelve UserBonus + campos opcionales.
   */
  async listAll(
    db: TenantDb,
    filters: {
      statuses?: string[];
      userId?: string;
      /**
       * Scope downstream del actor. Si `undefined`, no se filtra (admin
       * con `bonuses.view_all`). Si `[]`, devuelve 0 rows. Sino, `inArray`.
       */
      userIds?: string[];
      definitionId?: string;
      limit?: number;
      offset?: number;
    } = {},
  ): Promise<{ data: UserBonusWithRelations[]; total: number }> {
    // Short-circuit: si scope vacío, no hay nada.
    if (filters.userIds && filters.userIds.length === 0) {
      return { data: [], total: 0 };
    }

    const conditions = [];
    if (filters.userId) conditions.push(eq(userBonuses.userId, filters.userId));
    if (filters.userIds && filters.userIds.length > 0) {
      conditions.push(inArray(userBonuses.userId, filters.userIds));
    }
    if (filters.definitionId)
      conditions.push(eq(userBonuses.definitionId, filters.definitionId));
    if (filters.statuses && filters.statuses.length > 0) {
      conditions.push(
        inArray(
          userBonuses.status,
          filters.statuses as Array<UserBonus['status']>,
        ),
      );
    }
    const whereExpr = conditions.length > 0 ? and(...conditions) : undefined;

    const limit = filters.limit ?? 50;
    const offset = filters.offset ?? 0;

    const rows = await db
      .select({
        bonus: userBonuses,
        userUsername: users.username,
        userDisplayName: users.displayName,
        definitionCode: bonusDefinitions.code,
        definitionName: bonusDefinitions.name,
        definitionType: bonusDefinitions.type,
      })
      .from(userBonuses)
      .leftJoin(users, eq(users.id, userBonuses.userId))
      .leftJoin(
        bonusDefinitions,
        eq(bonusDefinitions.id, userBonuses.definitionId),
      )
      .where(whereExpr)
      .orderBy(desc(userBonuses.grantedAt))
      .limit(limit)
      .offset(offset);

    const data: UserBonusWithRelations[] = rows.map((r) => ({
      ...r.bonus,
      userUsername: r.userUsername,
      userDisplayName: r.userDisplayName,
      definitionCode: r.definitionCode,
      definitionName: r.definitionName,
      definitionType: r.definitionType,
    }));

    const totalResult = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(userBonuses)
      .where(whereExpr);
    const total = totalResult[0]?.count ?? 0;

    return { data, total };
  }

  /** Cuenta de bonos activos (para KPIs del panel). */
  async countActive(db: TenantDb): Promise<{ count: number; totalCommitted: string }> {
    const result = await db
      .select({
        count: sql<number>`count(*)::int`,
        totalCommitted: sql<string>`coalesce(sum(${userBonuses.remainingAmount}), 0)::text`,
      })
      .from(userBonuses)
      .where(eq(userBonuses.status, 'active'));
    const row = result[0];
    return {
      count: row?.count ?? 0,
      totalCommitted: row?.totalCommitted ?? '0',
    };
  }

  // ──────────────────────────────────────────────────────────────────────
  // Helpers
  // ──────────────────────────────────────────────────────────────────────

  /**
   * Convierte un string "100.50" a centavos (10050) para comparar con
   * exactitud (mismo helper que wallet.service).
   */
  private toCents(amount: string): number {
    const [int, dec = ''] = amount.split('.');
    const decPadded = (dec + '00').slice(0, 2);
    return Number(int) * 100 + Number(decPadded);
  }

  /**
   * Resuelve el funder de una definition. Devuelve el id del user que
   * paga. Para MVP es siempre `def.fundedByUserId` (el creador), pero
   * encapsulamos por si en sprints siguientes cambia (e.g. empleado del
   * socio → el socio).
   */
  resolveFunder(def: BonusDefinition): string {
    return def.fundedByUserId;
  }
}
