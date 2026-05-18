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

import { Injectable } from '@nestjs/common';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
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
import { UserHierarchyService } from '../user-hierarchy/user-hierarchy.service';
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

@Injectable()
export class CommissionsService {
  constructor(private readonly hierarchy: UserHierarchyService) {}

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
      if (
        err instanceof Error &&
        'code' in err &&
        (err as { code: string }).code === '23505'
      ) {
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
}
