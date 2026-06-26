/**
 * CommissionsService — reglas + cómputo de comisiones a la jerarquía.
 *
 * Operaciones MVP:
 *   - Rules: listRules, findRuleById, createRule, updateRule, archiveRule.
 *   - Payouts: listPayouts (con scope downstream del actor).
 *   - Compute: `computeForEvent(eventType, sourceUserId, sourceAmount)` —
 *     dado un evento, devuelve la lista de payouts a aplicar (sin persistir).
 *     Walking de ancestors: para cada ancestor del sourceUser, si su rol
 *     matchea alguna rule activa para ese eventType, suma un payout.
 *
 * `apply` (ejecutar realmente los wallet credits + insertar payout rows) se
 * implementa en Sprint 25 — este sprint deja solo el compute + CRUD reglas
 * + UI para que el admin pueda configurar antes del hookeo automático.
 *
 * Decisión: cuando un user tiene varios roles, gana TODOS los matches.
 * Ejemplo: si user X tiene rol cajero + socio, y hay rules para ambos,
 * recibe 2 payouts. Esto es deliberado — el admin controla esto via la
 * asignación de roles. Si quiere "solo el rol más alto", quitar el rol
 * menor del user.
 */

import { Injectable, Logger } from '@nestjs/common';
import { and, asc, desc, eq, gte, inArray, sql } from 'drizzle-orm';
import {
  commissionPayouts,
  commissionRules,
  roles,
  userRoles,
  users,
  type CommissionPayout,
  type CommissionRule,
  type NewCommissionRule,
} from '@casino/db';
import type { TenantDb } from '../tenant-resolver/tenant-context';
import { isUniqueViolation } from '../common/pg-error';
import { UserHierarchyService } from '../user-hierarchy/user-hierarchy.service';
import { WalletService } from '../wallet/wallet.service';
import {
  CommissionRuleConflictError,
  CommissionRuleNotFoundError,
} from './commissions.errors';

export interface CreateRuleParams {
  role: string;
  eventType: string;
  pct: string; // numeric serializado como string (Drizzle convención).
  active?: boolean;
  notes?: string | null;
}

export interface UpdateRuleParams {
  pct?: string;
  active?: boolean;
  notes?: string | null;
}

export interface ListPayoutsFilters {
  beneficiaryUserId?: string;
  /**
   * Scope downstream del actor: si está, filtra por
   * `beneficiary_user_id IN (...)`. Pasado por el controller cuando el
   * actor solo tiene `commissions.view` (sin `view_all`).
   */
  userIds?: string[];
  sourceEventType?: string;
  sourceEventId?: string;
  status?: CommissionPayout['status'];
  limit?: number;
  offset?: number;
}

/**
 * Plan calculado: qué payouts se ejecutarían si se aplicara `computeForEvent`.
 * Cada item NO está persistido — el `apply` (Sprint 25) los persiste +
 * ejecuta los wallet credits.
 */
export interface PlannedPayout {
  beneficiaryUserId: string;
  beneficiaryUsername: string | null;
  beneficiaryRoleAtTime: string;
  ruleId: string;
  pct: string;
  payoutAmount: string;
}

export interface PayoutWithBeneficiary extends CommissionPayout {
  beneficiaryUsername: string | null;
  beneficiaryDisplayName: string | null;
}

/**
 * Stats agregadas para el widget de `/admin/dashboard`. Cada bucket trae
 * los 3 períodos pre-computados; el frontend elige cuál mostrar.
 *
 * Montos como string (numeric(20,2)) — convención wallet, no perder precisión.
 */
export interface CommissionsStatsBucket {
  today: string;
  last7d: string;
  last30d: string;
}

export interface CommissionsStats {
  /** Lo que cobró el actor él mismo (beneficiary_user_id = actor.id). */
  earnedByMe: CommissionsStatsBucket;
  /** Lo que cobraron sus descendants (red downstream del actor). */
  earnedByTeam: CommissionsStatsBucket;
  /** Cantidad de payouts del actor en los últimos 7d (para contexto). */
  countByMe7d: number;
  /** Cantidad de payouts de su team en 7d. */
  countByTeam7d: number;
  /** Total del tenant en cada período. NULL si actor no tiene view_all. */
  tenantTotal: CommissionsStatsBucket | null;
}

@Injectable()
export class CommissionsService {
  private readonly logger = new Logger(CommissionsService.name);

  constructor(
    private readonly hierarchy: UserHierarchyService,
    private readonly walletService: WalletService,
  ) {}

  // ──────────────────────────────────────────────────────────────────────
  // Rules CRUD
  // ──────────────────────────────────────────────────────────────────────

  async listRules(
    db: TenantDb,
    opts: { eventType?: string; activeOnly?: boolean } = {},
  ): Promise<CommissionRule[]> {
    const conditions = [];
    if (opts.eventType) conditions.push(eq(commissionRules.eventType, opts.eventType));
    if (opts.activeOnly) conditions.push(eq(commissionRules.active, true));
    const where = conditions.length > 0 ? and(...conditions) : undefined;
    return db
      .select()
      .from(commissionRules)
      .where(where)
      .orderBy(asc(commissionRules.eventType), asc(commissionRules.role));
  }

  async findRuleById(db: TenantDb, id: string): Promise<CommissionRule> {
    const rows = await db
      .select()
      .from(commissionRules)
      .where(eq(commissionRules.id, id))
      .limit(1);
    if (!rows[0]) throw new CommissionRuleNotFoundError(id);
    return rows[0];
  }

  async createRule(
    db: TenantDb,
    params: CreateRuleParams,
  ): Promise<CommissionRule> {
    const values: NewCommissionRule = {
      role: params.role,
      eventType: params.eventType,
      pct: params.pct,
      active: params.active ?? true,
      notes: params.notes ?? null,
    };
    try {
      const inserted = await db
        .insert(commissionRules)
        .values(values)
        .returning();
      return inserted[0]!;
    } catch (err: unknown) {
      if (isUniqueViolation(err)) {
        throw new CommissionRuleConflictError(params.role, params.eventType);
      }
      throw err;
    }
  }

  async updateRule(
    db: TenantDb,
    id: string,
    patch: UpdateRuleParams,
  ): Promise<CommissionRule> {
    await this.findRuleById(db, id); // 404 si no existe
    const set: Partial<NewCommissionRule> = { updatedAt: new Date() };
    if (patch.pct !== undefined) set.pct = patch.pct;
    if (patch.active !== undefined) set.active = patch.active;
    if (patch.notes !== undefined) set.notes = patch.notes;
    const updated = await db
      .update(commissionRules)
      .set(set)
      .where(eq(commissionRules.id, id))
      .returning();
    return updated[0]!;
  }

  /** Soft-delete: pasa `active=false`. Mismo patrón payment_methods. */
  async archiveRule(db: TenantDb, id: string): Promise<CommissionRule> {
    return this.updateRule(db, id, { active: false });
  }

  // ──────────────────────────────────────────────────────────────────────
  // Stats (Sprint 32): widget en /admin/dashboard
  // ──────────────────────────────────────────────────────────────────────

  /**
   * Stats agregadas para el actor: lo que cobró él + lo que cobró su red
   * downstream, en 3 ventanas (today UTC, last7d, last30d).
   *
   * `tenantTotal` se incluye SOLO si el actor tiene `commissions.view_all`
   * (el caller pasa `includeTenantTotal=true` cuando corresponde).
   *
   * Una sola query SQL que computa todos los buckets en un pase con
   * `FILTER (WHERE ...)`. Más eficiente que 6-9 queries separadas.
   *
   * Solo cuenta payouts `status='paid'` (los `pending`/`failed`/`refunded`
   * no son "ingreso real" todavía).
   */
  async getStatsForActor(
    db: TenantDb,
    actorId: string,
    teamUserIds: string[],
    includeTenantTotal: boolean,
  ): Promise<CommissionsStats> {
    const now = new Date();
    const startOfTodayUtc = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
    );
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    // Suma helper: agrega un WHERE por scope + window y devuelve { sum, count }.
    const sumWhere = async (
      scope: 'me' | 'team' | 'tenant',
      since: Date,
    ): Promise<{ sum: string; count: number }> => {
      const conditions = [
        eq(commissionPayouts.status, 'paid'),
        gte(commissionPayouts.createdAt, since),
      ];
      if (scope === 'me') {
        conditions.push(eq(commissionPayouts.beneficiaryUserId, actorId));
      } else if (scope === 'team') {
        if (teamUserIds.length === 0) {
          return { sum: '0', count: 0 };
        }
        conditions.push(
          inArray(commissionPayouts.beneficiaryUserId, teamUserIds),
        );
      }
      // scope === 'tenant' → sin filter por beneficiary.

      const rows = await db
        .select({
          sum: sql<string>`COALESCE(SUM(${commissionPayouts.payoutAmount}), 0)::text`,
          count: sql<number>`COUNT(*)::int`,
        })
        .from(commissionPayouts)
        .where(and(...conditions));
      return {
        sum: rows[0]?.sum ?? '0',
        count: Number(rows[0]?.count ?? 0),
      };
    };

    // Disparamos 8-11 queries en paralelo (negligible para volumen MVP).
    const [
      meToday,
      me7d,
      me30d,
      teamToday,
      team7d,
      team30d,
      tenantToday,
      tenantA7d,
      tenant30d,
    ] = await Promise.all([
      sumWhere('me', startOfTodayUtc),
      sumWhere('me', sevenDaysAgo),
      sumWhere('me', thirtyDaysAgo),
      sumWhere('team', startOfTodayUtc),
      sumWhere('team', sevenDaysAgo),
      sumWhere('team', thirtyDaysAgo),
      includeTenantTotal
        ? sumWhere('tenant', startOfTodayUtc)
        : Promise.resolve({ sum: '0', count: 0 }),
      includeTenantTotal
        ? sumWhere('tenant', sevenDaysAgo)
        : Promise.resolve({ sum: '0', count: 0 }),
      includeTenantTotal
        ? sumWhere('tenant', thirtyDaysAgo)
        : Promise.resolve({ sum: '0', count: 0 }),
    ]);

    return {
      earnedByMe: {
        today: meToday.sum,
        last7d: me7d.sum,
        last30d: me30d.sum,
      },
      earnedByTeam: {
        today: teamToday.sum,
        last7d: team7d.sum,
        last30d: team30d.sum,
      },
      countByMe7d: me7d.count,
      countByTeam7d: team7d.count,
      tenantTotal: includeTenantTotal
        ? {
            today: tenantToday.sum,
            last7d: tenantA7d.sum,
            last30d: tenant30d.sum,
          }
        : null,
    };
  }

  // ──────────────────────────────────────────────────────────────────────
  // Payouts (read-only listing — apply en Sprint 25)
  // ──────────────────────────────────────────────────────────────────────

  async listPayouts(
    db: TenantDb,
    filters: ListPayoutsFilters = {},
  ): Promise<{ data: PayoutWithBeneficiary[]; total: number }> {
    if (filters.userIds && filters.userIds.length === 0) {
      return { data: [], total: 0 };
    }
    const conditions = [];
    if (filters.beneficiaryUserId) {
      conditions.push(
        eq(commissionPayouts.beneficiaryUserId, filters.beneficiaryUserId),
      );
    }
    if (filters.userIds && filters.userIds.length > 0) {
      conditions.push(
        inArray(commissionPayouts.beneficiaryUserId, filters.userIds),
      );
    }
    if (filters.sourceEventType) {
      conditions.push(eq(commissionPayouts.sourceEventType, filters.sourceEventType));
    }
    if (filters.sourceEventId) {
      conditions.push(eq(commissionPayouts.sourceEventId, filters.sourceEventId));
    }
    if (filters.status) {
      conditions.push(eq(commissionPayouts.status, filters.status));
    }
    const where = conditions.length > 0 ? and(...conditions) : undefined;
    const limit = Math.min(Math.max(filters.limit ?? 50, 1), 200);
    const offset = Math.max(filters.offset ?? 0, 0);

    const rows = await db
      .select({
        payout: commissionPayouts,
        beneficiaryUsername: users.username,
        beneficiaryDisplayName: users.displayName,
      })
      .from(commissionPayouts)
      .leftJoin(users, eq(users.id, commissionPayouts.beneficiaryUserId))
      .where(where)
      .orderBy(desc(commissionPayouts.createdAt), desc(commissionPayouts.id))
      .limit(limit)
      .offset(offset);

    const data: PayoutWithBeneficiary[] = rows.map((r) => ({
      ...r.payout,
      beneficiaryUsername: r.beneficiaryUsername,
      beneficiaryDisplayName: r.beneficiaryDisplayName,
    }));

    const totalRows = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(commissionPayouts)
      .where(where);

    return { data, total: totalRows[0]?.n ?? 0 };
  }

  // ──────────────────────────────────────────────────────────────────────
  // Compute (sin persistir — apply en Sprint 25)
  // ──────────────────────────────────────────────────────────────────────

  /**
   * Dado un evento sobre `sourceUserId` con `sourceAmount`, calcula qué
   * payouts deberían generarse a la jerarquía upstream según las rules
   * activas para `eventType`.
   *
   * Algoritmo:
   *   1. Resolver ancestors activos del sourceUser (orden bottom-up).
   *   2. Para cada ancestor, obtener sus roles activos.
   *   3. Para cada rol del ancestor, buscar rule activa para
   *      (role, eventType). Si existe, agregar PlannedPayout al resultado.
   *   4. NO deduplicar: si el mismo ancestor tiene 2 roles que matchean,
   *      gana 2 payouts (decisión documentada arriba).
   *
   * Devuelve [] si:
   *   - No hay ancestors.
   *   - Ningún ancestor tiene rol que matchee con rules activas.
   *   - `sourceAmount` es 0 (skip, no genera nada).
   */
  async computeForEvent(
    db: TenantDb,
    eventType: string,
    sourceUserId: string,
    sourceAmount: string,
  ): Promise<PlannedPayout[]> {
    const sourceNum = Number(sourceAmount);
    if (!Number.isFinite(sourceNum) || sourceNum <= 0) {
      return [];
    }

    // 1. Rules activas para este evento.
    const activeRules = await this.listRules(db, {
      eventType,
      activeOnly: true,
    });
    if (activeRules.length === 0) return [];

    // Index rules por role para lookup O(1).
    const rulesByRole = new Map<string, CommissionRule>();
    for (const rule of activeRules) {
      rulesByRole.set(rule.role, rule);
    }

    // 2. Ancestors activos del source.
    const ancestorIds = await this.hierarchy.getActiveAncestors(
      db,
      sourceUserId,
    );
    if (ancestorIds.length === 0) return [];

    // 3. Para cada ancestor, sus roles activos + el username (snapshot).
    const ancestorData = await db
      .select({
        userId: users.id,
        username: users.username,
        roleCode: roles.code,
      })
      .from(users)
      .leftJoin(userRoles, eq(userRoles.userId, users.id))
      .leftJoin(roles, eq(roles.id, userRoles.roleId))
      .where(inArray(users.id, ancestorIds));

    // 4. Build payouts walking ancestor by ancestor.
    const payouts: PlannedPayout[] = [];
    // Mantener orden bottom-up (cajero primero, socio último) según
    // `ancestorIds` que ya viene en ese orden desde `getActiveAncestors`.
    for (const ancestorId of ancestorIds) {
      const rolesOfAncestor = ancestorData.filter(
        (r) => r.userId === ancestorId,
      );
      if (rolesOfAncestor.length === 0) continue;
      const username = rolesOfAncestor[0]?.username ?? null;
      for (const row of rolesOfAncestor) {
        if (!row.roleCode) continue;
        const rule = rulesByRole.get(row.roleCode);
        if (!rule) continue;
        const pctNum = Number(rule.pct);
        const payoutAmount = (sourceNum * pctNum) / 100;
        // Round a 2 decimales (centavos) por convención wallet.
        const rounded = Math.round(payoutAmount * 100) / 100;
        payouts.push({
          beneficiaryUserId: ancestorId,
          beneficiaryUsername: username,
          beneficiaryRoleAtTime: row.roleCode,
          ruleId: rule.id,
          pct: rule.pct,
          payoutAmount: rounded.toFixed(2),
        });
      }
    }
    return payouts;
  }

  // ──────────────────────────────────────────────────────────────────────
  // Apply (Sprint 25): persiste + ejecuta los wallet transfers
  // ──────────────────────────────────────────────────────────────────────

  /**
   * Aplica el plan calculado por `computeForEvent` — persiste rows en
   * `commission_payouts` y ejecuta los wallet transfers approver→beneficiary
   * dentro de la misma transacción del caller.
   *
   * **Funder = approver** (decisión confirmada por dueño, Sprint 25 DEVLOG).
   * Cuando se aprueba un deposit o se paga un withdrawal, el OPERADOR que
   * clicka aprobar es quien descuenta de su wallet las commissions de TODA
   * la cadena upstream del cliente.
   *
   * Edge cases:
   *
   *  1. **approver es uno de los ancestors** (Opción 1a confirmada): la
   *     row del payout se inserta pero NO se mueve plata (net zero). El
   *     `wallet_tx_id` queda NULL y `status='paid'`. Esto preserva el
   *     reporting "cuánto generé esta semana" sin gastar dos wallet_tx
   *     rows en una operación de balance cero.
   *
   *  2. **approver sin saldo** (Opción 3a confirmada): tira
   *     `InsufficientFunderBalanceError` → el caller (deposits.approve /
   *     withdrawals.markPaid) hace rollback de la TX completa. El
   *     deposit/withdrawal queda en su estado original. El operador
   *     ve un 409 con mensaje específico.
   *
   *  3. **Re-aplicación del mismo evento**: idempotente por idempotency
   *     key del wallet (`commission:<eventType>:<eventId>:<beneficiary>`).
   *     Si una row ya existe en `commission_payouts` para esa terna,
   *     skip + devolver. Defensa doble: el deposit.approve también es
   *     idempotente por status.
   *
   * **Importante**: este método debe correr DENTRO de una TX externa (la
   * del caller). El parámetro `db` ya es el `tx` del caller — los wallet
   * transfers internos abren savepoints anidados via drizzle.
   *
   * Devuelve las rows persistidas de `commission_payouts`.
   */
  /**
   * Sprint 50 (CAMBIO BREAKING): YA NO ejecuta wallet transfers en el
   * momento. Solo inserta rows en `commission_payouts` con `status='accrued'`
   * y `wallet_tx_id=null`. La liquidación efectiva se hace después con
   * `settle()` (manual, por el admin).
   *
   * Motivación del cambio: el cajero/approver YA NO necesita "caja chica"
   * de fichas para pagar commissions. El sistema acumula lo que se le
   * debe a cada beneficiario y el admin liquida periódicamente (semanal/
   * mensual). El approver NUNCA paga de su wallet — opera sin riesgo de
   * capital propio.
   *
   * `params.approverUserId` se mantiene en la signature por compat con
   * los callers (deposits.approve, withdrawals.markPaid) pero YA NO se
   * usa para chequear saldo ni transferir. Sigue audit-loggeado.
   *
   * Idempotencia: si ya existe row para `(eventType, eventId, beneficiary)`,
   * skip + devolver la existente (defensa double-apply, no debería pasar).
   */
  async applyForEvent(
    db: TenantDb,
    params: {
      eventType: string;
      sourceUserId: string;
      sourceAmount: string;
      sourceEventId: string;
      approverUserId: string;
    },
  ): Promise<CommissionPayout[]> {
    const plan = await this.computeForEvent(
      db,
      params.eventType,
      params.sourceUserId,
      params.sourceAmount,
    );
    if (plan.length === 0) return [];

    const persisted: CommissionPayout[] = [];

    for (const planned of plan) {
      // Idempotency check.
      const existing = await db
        .select()
        .from(commissionPayouts)
        .where(
          and(
            eq(commissionPayouts.sourceEventType, params.eventType),
            eq(commissionPayouts.sourceEventId, params.sourceEventId),
            eq(commissionPayouts.beneficiaryUserId, planned.beneficiaryUserId),
          ),
        )
        .limit(1);
      if (existing[0]) {
        persisted.push(existing[0]);
        continue;
      }

      const inserted = await db
        .insert(commissionPayouts)
        .values({
          sourceEventType: params.eventType,
          sourceEventId: params.sourceEventId,
          beneficiaryUserId: planned.beneficiaryUserId,
          beneficiaryRoleAtTime: planned.beneficiaryRoleAtTime,
          ruleId: planned.ruleId,
          sourceAmount: params.sourceAmount,
          pct: planned.pct,
          payoutAmount: planned.payoutAmount,
          walletTxId: null,
          status: 'accrued',
          paidAt: null,
        })
        .returning();
      persisted.push(inserted[0]!);
    }

    return persisted;
  }

  // ──────────────────────────────────────────────────────────────────────
  // Settle (Sprint 50): liquidación de commissions accrued.
  // ──────────────────────────────────────────────────────────────────────

  /**
   * Liquida un set de commissions accrued. Por cada payout:
   *   1. Mintea las fichas (type='mint', source='commission_settlement').
   *   2. Acredita al beneficiary (transfer interno o mint directo a su wallet).
   *   3. Marca el payout como 'paid' + linkea wallet_tx_id.
   *
   * Atómico POR PAYOUT (uno falla, los otros siguen). Devuelve summary
   * con success/fail count.
   *
   * Si `payoutIds` está vacío, liquida TODOS los 'accrued' del tenant.
   */
  async settle(
    db: TenantDb,
    payoutIds: string[],
    actorUserId: string,
  ): Promise<{
    settled: number;
    failed: number;
    totalPaid: string;
    results: Array<{ id: string; status: 'paid' | 'failed'; error?: string }>;
  }> {
    // 1. Pickear los payouts target. Filtrar por status='accrued' siempre
    //    (defensa contra re-settle de uno ya pagado).
    const targets = payoutIds.length > 0
      ? await db
          .select()
          .from(commissionPayouts)
          .where(
            and(
              inArray(commissionPayouts.id, payoutIds),
              eq(commissionPayouts.status, 'accrued'),
            ),
          )
      : await db
          .select()
          .from(commissionPayouts)
          .where(eq(commissionPayouts.status, 'accrued'));

    if (targets.length === 0) {
      return { settled: 0, failed: 0, totalPaid: '0.00', results: [] };
    }

    const results: Array<{ id: string; status: 'paid' | 'failed'; error?: string }> = [];
    let totalPaidCents = 0;

    for (const payout of targets) {
      try {
        // Atómico por payout via savepoint.
        await db.transaction(async (tx) => {
          // Mint fichas + acreditar al beneficiary en una sola tx tipo 'mint'.
          // Usa la wallet del beneficiary (la crea si no existe).
          const wallet = await this.walletService.getOrCreateWalletForUser(
            tx as unknown as TenantDb,
            payout.beneficiaryUserId,
          );
          const idemKey = `commission_settle:${payout.id}`;
          const walletTx = await this.walletService.mintToWallet(
            tx as unknown as TenantDb,
            {
              walletId: wallet.id,
              amount: payout.payoutAmount,
              source: 'commission_settlement',
              referenceId: payout.id,
              idempotencyKey: idemKey,
              reason: `Settle commission ${payout.id}`,
              createdBy: actorUserId,
              counterpartyUserId: null,
            },
          );

          // Marcar payout paid + linkear wallet_tx.
          await tx
            .update(commissionPayouts)
            .set({
              status: 'paid',
              walletTxId: walletTx.id,
              paidAt: new Date(),
            })
            .where(eq(commissionPayouts.id, payout.id));
        });

        totalPaidCents += Math.round(Number(payout.payoutAmount) * 100);
        results.push({ id: payout.id, status: 'paid' });
      } catch (err) {
        this.logger.error(
          `Settle falló para payout ${payout.id}: ${(err as Error).message}`,
        );
        // Marcar como failed con error message.
        try {
          await db
            .update(commissionPayouts)
            .set({
              status: 'failed',
              error: (err as Error).message.slice(0, 500),
            })
            .where(eq(commissionPayouts.id, payout.id));
        } catch {
          /* swallow — el error principal ya está */
        }
        results.push({
          id: payout.id,
          status: 'failed',
          error: (err as Error).message,
        });
      }
    }

    const settled = results.filter((r) => r.status === 'paid').length;
    const failed = results.filter((r) => r.status === 'failed').length;
    this.logger.log(
      `Settle ejecutado por user=${actorUserId}: ${settled}/${targets.length} OK, ${failed} fail, total=${(totalPaidCents / 100).toFixed(2)}.`,
    );

    return {
      settled,
      failed,
      totalPaid: (totalPaidCents / 100).toFixed(2),
      results,
    };
  }

  /**
   * Resumen por beneficiary de cuánto se le debe (status='accrued').
   * Usado por el dashboard widget + tab Pendientes.
   */
  async pendingSummary(
    db: TenantDb,
    filters: { restrictToUserIds?: string[] } = {},
  ): Promise<Array<{
    beneficiaryUserId: string;
    beneficiaryUsername: string | null;
    role: string | null;
    pendingAmount: string;
    payoutsCount: number;
  }>> {
    const conds = [eq(commissionPayouts.status, 'accrued')];
    if (filters.restrictToUserIds?.length) {
      conds.push(inArray(commissionPayouts.beneficiaryUserId, filters.restrictToUserIds));
    }

    const rows = await db
      .select({
        beneficiaryUserId: commissionPayouts.beneficiaryUserId,
        beneficiaryUsername: users.username,
        role: commissionPayouts.beneficiaryRoleAtTime,
        pendingAmount: sql<string>`COALESCE(SUM(${commissionPayouts.payoutAmount})::text, '0')`,
        payoutsCount: sql<number>`COUNT(*)::int`,
      })
      .from(commissionPayouts)
      .leftJoin(users, eq(users.id, commissionPayouts.beneficiaryUserId))
      .where(and(...conds))
      .groupBy(
        commissionPayouts.beneficiaryUserId,
        users.username,
        commissionPayouts.beneficiaryRoleAtTime,
      )
      .orderBy(sql`SUM(${commissionPayouts.payoutAmount}) DESC NULLS LAST`);

    return rows;
  }
}
