/**
 * UserBonusesService — instancias de bono asignadas a usuarios.
 *
 * Operaciones MVP:
 *   - `grantManual(actorId, dto)`: cajero/admin otorga un bono. Debita
 *     el wallet del funder. Crea `user_bonus` con status='active'.
 *     Idempotente via `grantIdempotencyKey`.
 *   - `cancel(id, actorId, reason)`: anula un bono pendiente/activo.
 *     Reversa al funder (`bonus_funding_revert`). El user pierde el
 *     bono pero NO sufre debit (las fichas no estaban en su wallet).
 *   - `forceClear(id, actorId)`: el admin decide entregar las fichas
 *     remaining al wallet real del user (`bonus_clear` credit).
 *     Requiere permiso especial.
 *   - `listForUser(userId, filters)`: bonos de un user.
 *   - `findById(id)`.
 *
 * Diseño:
 *   - Toda mutación corre en TX. El wallet primitive `executeTransaction`
 *     ya gestiona FOR UPDATE + idempotency-check.
 *   - Como `executeTransaction` ya es transaccional, dividimos cada op
 *     en dos pasos: (1) wallet TX, (2) UPDATE user_bonus. Aceptamos
 *     una ventana microscópica entre los dos commits (si el server muere
 *     entre 1 y 2, queda la wallet_tx pero el user_bonus no se updatea).
 *     Mitigación: idempotencia + audit log + reconcile job nocturno
 *     (futuro). Para sprint MVP es aceptable.
 *   - Alternativa más estricta: wallet primitives soportarían operar
 *     dentro de una TX externa. Refactor para sprint Performance.
 */

import { Injectable, Logger } from '@nestjs/common';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import {
  bonusDefinitions,
  users,
  userBonuses,
  type BonusDefinition,
  type NewUserBonus,
  type UserBonus,
} from '@casino/db';
import { NotificationsService } from '../notifications/notifications.service';
import type { TenantDb } from '../tenant-resolver/tenant-context';
import { WalletService } from '../wallet/wallet.service';
import {
  BonusDefinitionNotActiveError,
  BonusDefinitionNotFoundError,
  BonusTargetNotFoundError,
  FunderInsufficientBalanceError,
  GrantIdempotencyConflictError,
  UserBonusInvalidStatusError,
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
  private readonly logger = new Logger(UserBonusesService.name);

  constructor(
    private readonly walletService: WalletService,
    private readonly notifications: NotificationsService,
  ) {}

  // ──────────────────────────────────────────────────────────────────────
  // Grant manual
  // ──────────────────────────────────────────────────────────────────────
  async grantManual(db: TenantDb, params: GrantManualParams): Promise<UserBonus> {
    // 1. Idempotency check rápido (la UNIQUE index también lo enforce; este
    //    es el path optimista para devolver el existing antes de fallar).
    const existing = await db
      .select()
      .from(userBonuses)
      .where(eq(userBonuses.grantIdempotencyKey, params.grantIdempotencyKey))
      .limit(1);
    if (existing[0]) {
      // Verificar que sea la misma operación.
      const sameParams =
        existing[0].userId === params.userId &&
        existing[0].definitionId === params.definitionId &&
        this.toCents(existing[0].grantedAmount) === this.toCents(params.amount);
      if (!sameParams) {
        throw new GrantIdempotencyConflictError(params.grantIdempotencyKey);
      }
      return existing[0];
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

    // 4. Debitar el wallet del funder (definition.fundedByUserId).
    //    Esto crea la wallet_tx de tipo `bonus_funding`. La idempotency
    //    key del wallet usa `bonus_grant:<bonus_idemp_key>` para no
    //    colisionar con otros usos.
    const funderWallet = await this.walletService.getOrCreateWalletForUser(
      db,
      def.fundedByUserId,
    );

    let fundingTxId: string;
    try {
      const tx = await this.walletService.executeBonusFunding(db, {
        walletId: funderWallet.id,
        amount: params.amount,
        idempotencyKey: `bonus_grant:${params.grantIdempotencyKey}`,
        actorUserId: params.actorUserId,
        reason: `Funding bono ${def.code}`,
        counterpartyUserId: params.userId,
      });
      fundingTxId = tx.id;
    } catch (err) {
      if (err instanceof InsufficientBalanceError) {
        throw new FunderInsufficientBalanceError(
          def.fundedByUserId,
          params.amount,
          err.available,
        );
      }
      if (err instanceof IdempotencyConflictError) {
        // Si la wallet tx ya existía con parámetros distintos, propagamos
        // como conflict del grant (raro pero defensivo).
        throw new GrantIdempotencyConflictError(params.grantIdempotencyKey);
      }
      throw err;
    }

    // 5. Crear el user_bonus row.
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
      const created = inserted[0]!;
      // Notif al user dueño del bono: "tu bono fue otorgado".
      // Fail-soft: si falla, el bono ya está creado y fondeado.
      // SOLO en el success path del INSERT — no en el early-return de
      // idempotency (línea 92) ni en el 23505 race-recovery (abajo).
      for (const channel of ['in_app', 'email'] as const) {
        try {
          await this.notifications.enqueue(db, {
            userId: created.userId,
            kind: 'bonus_granted',
            channel,
            payload: {
              bonusId: created.id,
              definitionCode: def.code,
              definitionName: def.name,
              amount: created.grantedAmount,
              bonusType: def.type,
            },
          });
        } catch (err) {
          this.logger.error(
            `Notif bonus_granted (${channel}) falló user=${created.userId} bonus=${created.id}: ${(err as Error).message}`,
          );
        }
      }
      return created;
    } catch (err: unknown) {
      // Race: otra request con la misma idempotency key ganó. Releemos.
      // NO notificamos acá — el creador "ganador" ya disparó la notif.
      if (
        err instanceof Error &&
        'code' in err &&
        (err as { code: string }).code === '23505'
      ) {
        const re = await db
          .select()
          .from(userBonuses)
          .where(eq(userBonuses.grantIdempotencyKey, params.grantIdempotencyKey))
          .limit(1);
        if (re[0]) return re[0];
      }
      throw err;
    }
  }

  // ──────────────────────────────────────────────────────────────────────
  // Cancel (reversa al funder)
  // ──────────────────────────────────────────────────────────────────────
  async cancel(
    db: TenantDb,
    id: string,
    actorUserId: string,
    reason: string,
  ): Promise<UserBonus> {
    const bonus = await this.findById(db, id);

    // Solo activos/pending se pueden cancelar.
    if (!['active', 'pending', 'wagering'].includes(bonus.status)) {
      throw new UserBonusInvalidStatusError(id, bonus.status, [
        'active',
        'pending',
        'wagering',
      ]);
    }

    // Cargar funder wallet.
    const funderWallet = await this.walletService.getOrCreateWalletForUser(
      db,
      bonus.fundedByUserId,
    );

    // Reversar al funder por el monto remaining (no granted — si el user
    // ya gastó parte en wagering, esa parte se considera consumida).
    const revertAmount = bonus.remainingAmount;
    if (this.toCents(revertAmount) > 0) {
      await this.walletService.executeBonusFundingRevert(db, {
        walletId: funderWallet.id,
        amount: revertAmount,
        // Distinto idempotency key para el revert (no colisiona con el
        // grant). Si el cancel se reintenta, el segundo intento ve la
        // tx existente y no duplica.
        idempotencyKey: `bonus_cancel:${bonus.id}`,
        actorUserId,
        reason: `Cancel bono ${bonus.id}: ${reason}`,
        counterpartyUserId: bonus.userId,
        relatedTxId: bonus.fundingTxId,
      });
    }

    // Update user_bonus.
    const updated = await db
      .update(userBonuses)
      .set({
        status: 'cancelled',
        remainingAmount: '0.00',
        cancelledAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(userBonuses.id, id))
      .returning();
    return updated[0]!;
  }

  // ──────────────────────────────────────────────────────────────────────
  // Force clear (admin entrega fichas al user wallet)
  // ──────────────────────────────────────────────────────────────────────
  async forceClear(
    db: TenantDb,
    id: string,
    actorUserId: string,
    reason: string,
  ): Promise<UserBonus> {
    const bonus = await this.findById(db, id);

    if (!['active', 'pending', 'wagering'].includes(bonus.status)) {
      throw new UserBonusInvalidStatusError(id, bonus.status, [
        'active',
        'pending',
        'wagering',
      ]);
    }

    const userWallet = await this.walletService.getOrCreateWalletForUser(
      db,
      bonus.userId,
    );

    const clearAmount = bonus.remainingAmount;
    if (this.toCents(clearAmount) > 0) {
      await this.walletService.executeBonusClear(db, {
        walletId: userWallet.id,
        amount: clearAmount,
        idempotencyKey: `bonus_clear:${bonus.id}`,
        actorUserId,
        reason: `Force clear bono ${bonus.id}: ${reason}`,
        counterpartyUserId: bonus.fundedByUserId,
        relatedTxId: bonus.fundingTxId,
      });
    }

    const updated = await db
      .update(userBonuses)
      .set({
        status: 'cleared',
        remainingAmount: '0.00',
        clearedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(userBonuses.id, id))
      .returning();
    return updated[0]!;
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
  ): Promise<{ data: UserBonus[]; total: number }> {
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

    const data = await db
      .select()
      .from(userBonuses)
      .where(whereExpr)
      .orderBy(desc(userBonuses.grantedAt))
      .limit(limit)
      .offset(offset);

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
      definitionId?: string;
      limit?: number;
      offset?: number;
    } = {},
  ): Promise<{ data: UserBonusWithRelations[]; total: number }> {
    const conditions = [];
    if (filters.userId) conditions.push(eq(userBonuses.userId, filters.userId));
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
