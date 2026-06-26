/**
 * LoginStreakService — claim diario con streak counter.
 *
 * Config esperada:
 *   {
 *     "prizes": [
 *       { "kind": "chips", "amount": 50 },     // día 1
 *       { "kind": "chips", "amount": 100 },    // día 2
 *       { "kind": "chips", "amount": 200 },    // día 3
 *       ...
 *     ],
 *     "forgivenessDays": 0,        // gap permitido sin reset; 0 = hard reset.
 *     "onMax": "hold",             // "hold" (default) | "reset" | "cycle"
 *     "autoClaimOnLogin": false    // hook desde TenantAuthService.login
 *   }
 *
 * Lógica del claim:
 *   - daysDiff = today - lastClaimDay (en días calendario UTC).
 *   - daysDiff = 0 → idempotent (devuelve reward existente de hoy).
 *   - daysDiff = 1 → streak++. (caso normal "vino ayer y hoy").
 *   - daysDiff ∈ [2, 1+forgivenessDays] → perdonado, streak++.
 *   - else (gap > forgivenessDays+1 o nunca claimed) → reset streak=1.
 *
 * Premio del día = `prizes[idx]` donde:
 *   - idx = min(streak-1, prizes.length-1) si onMax='hold'.
 *   - idx = (streak-1) % prizes.length si onMax='cycle'.
 *   - si onMax='reset' y streak > prizes.length → streak=1, idx=0.
 *
 * State guardado en `promotion_participants.current_progress`:
 *   { streak, lastClaimDay, lastPrize }
 */

import { Injectable, Logger } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import {
  promotionParticipants,
  promotionRewards,
  promotions as promotionsTable,
  type NewPromotionParticipant,
  type NewPromotionReward,
  type Promotion,
  type PromotionReward,
} from '@casino/db';
import type { TenantDb } from '../tenant-resolver/tenant-context';
import { isUniqueViolation } from '../common/pg-error';
import {
  PromotionNotActiveError,
  PromotionScheduleClosedError,
  PromotionTypeMismatchError,
} from './promotions.errors';
import {
  PromotionPrizeAwarder,
  type PromotionPrize,
} from './prize-awarder.service';
import { PromotionsService } from './promotions.service';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

interface StreakConfig {
  prizes: PromotionPrize[];
  forgivenessDays?: number;
  onMax?: 'hold' | 'reset' | 'cycle';
  autoClaimOnLogin?: boolean;
}

export interface StreakProgress {
  streak: number;
  lastClaimDay: string; // YYYY-MM-DD
  lastPrize?: PromotionPrize;
}

export interface ClaimResult {
  /** El reward row recién creado o el existente (idempotency hit). */
  reward: PromotionReward;
  /** streak del user DESPUÉS de este claim. */
  streak: number;
  /** Premio entregado. */
  prize: PromotionPrize;
  /** True si fue creado en este request, false si idempotent hit. */
  created: boolean;
}

@Injectable()
export class LoginStreakService {
  private readonly logger = new Logger(LoginStreakService.name);

  constructor(
    private readonly promotionsService: PromotionsService,
    private readonly prizeAwarder: PromotionPrizeAwarder,
  ) {}

  /**
   * Reclama el streak del día para el user. Si ya reclamó hoy → idempotent.
   *
   * `now` parameter para tests determinísticos. Default = `new Date()`.
   */
  async claim(
    db: TenantDb,
    params: { promotionId: string; userId: string },
    options: { now?: Date } = {},
  ): Promise<ClaimResult> {
    const now = options.now ?? new Date();

    // 1. Cargar promotion + validar.
    const promo = await this.promotionsService.findById(db, params.promotionId);
    if (promo.type !== 'login_streak') {
      throw new PromotionTypeMismatchError(promo.id, 'login_streak', promo.type);
    }
    if (promo.status !== 'active') {
      throw new PromotionNotActiveError(promo.id, promo.status);
    }
    this.assertWithinSchedule(promo, now);

    const config = this.parseConfig(promo);
    const todayAnchor = this.dayAnchor(now);
    // Incluimos `promo.id` en la key para que los wallet_tx derivados
    // (promo_fund:<key>, promo_reward:<key>) sean únicos GLOBAL — si el
    // user tiene 2 login_streak activas en el mismo día (e.g. una con
    // autoClaim, otra manual), ambas pueden claim sin colisionar en
    // la unique idempotency_key del wallet.
    const idempotencyKey = `streak_claim:${promo.id}:${params.userId}:${todayAnchor}`;

    // 2. Idempotency check: ¿reward para hoy ya existe?
    const existing = await db
      .select()
      .from(promotionRewards)
      .where(
        and(
          eq(promotionRewards.promotionId, promo.id),
          eq(promotionRewards.idempotencyKey, idempotencyKey),
        ),
      )
      .limit(1);
    if (existing[0]) {
      const reward = existing[0];
      return {
        reward,
        streak: (reward.metadata as { streak?: number }).streak ?? 0,
        prize: reward.prize as PromotionPrize,
        created: false,
      };
    }

    // 3. Calcular nuevo streak basado en participant state.
    const participant = await this.loadOrCreateParticipant(db, promo.id, params.userId);
    const prevProgress = participant.currentProgress as Partial<StreakProgress>;
    const newStreak = this.computeNewStreak(
      prevProgress.streak ?? 0,
      prevProgress.lastClaimDay,
      todayAnchor,
      config,
    );

    // 4. Premio del día.
    const prizeIdx = this.resolvePrizeIndex(newStreak, config);
    const prize = config.prizes[prizeIdx]!;

    // 5. Award (wallet / bonus / etc.).
    const { walletTxId, bonusId } = await this.prizeAwarder.award(db, {
      context: {
        id: promo.id,
        code: promo.code,
        fundedByUserId: promo.fundedByUserId,
      },
      userId: params.userId,
      prize,
      idempotencyKeyBase: idempotencyKey,
    });

    // 6. Insert reward row.
    const newRow: NewPromotionReward = {
      promotionId: promo.id,
      userId: params.userId,
      prize,
      walletTxId: walletTxId ?? null,
      bonusId: bonusId ?? null,
      idempotencyKey,
      metadata: {
        kind: 'login_streak',
        streak: newStreak,
        prizeIndex: prizeIdx,
        dayAnchor: todayAnchor,
      },
    };
    let reward: PromotionReward;
    try {
      const inserted = await db.insert(promotionRewards).values(newRow).returning();
      reward = inserted[0]!;
    } catch (err: unknown) {
      // Race: otro request ganó. Releemos.
      if (isUniqueViolation(err)) {
        const re = await db
          .select()
          .from(promotionRewards)
          .where(
            and(
              eq(promotionRewards.promotionId, promo.id),
              eq(promotionRewards.idempotencyKey, idempotencyKey),
            ),
          )
          .limit(1);
        if (re[0]) {
          return {
            reward: re[0],
            streak: (re[0].metadata as { streak?: number }).streak ?? newStreak,
            prize: re[0].prize as PromotionPrize,
            created: false,
          };
        }
      }
      throw err;
    }

    // 7. Update participant state. `.returning()` para asegurar que el
    // update realmente se materializa (sin returning, observamos un
    // patrón donde la query Drizzle quedaba "pendiente" en ciertas
    // combinaciones de pool/await).
    const newProgress: StreakProgress = {
      streak: newStreak,
      lastClaimDay: todayAnchor,
      lastPrize: prize,
    };
    await db
      .update(promotionParticipants)
      .set({ currentProgress: newProgress, updatedAt: new Date() })
      .where(eq(promotionParticipants.id, participant.id))
      .returning({ id: promotionParticipants.id });

    return { reward, streak: newStreak, prize, created: true };
  }

  /**
   * Devuelve el state actual del user para la promotion (read-only).
   * Útil para que el frontend muestre "día N de M — próximo premio: X".
   * Si nunca participó, devuelve `null`.
   */
  async getMyProgress(
    db: TenantDb,
    promotionId: string,
    userId: string,
  ): Promise<StreakProgress | null> {
    const rows = await db
      .select()
      .from(promotionParticipants)
      .where(
        and(
          eq(promotionParticipants.promotionId, promotionId),
          eq(promotionParticipants.userId, userId),
        ),
      )
      .limit(1);
    if (!rows[0]) return null;
    return rows[0].currentProgress as StreakProgress;
  }

  // ──────────────────────────────────────────────────────────────────────
  // Hook: auto-claim en login
  // ──────────────────────────────────────────────────────────────────────

  /**
   * Llamado desde `TenantAuthService.login` post-success. Encuentra
   * promotions activas tipo `login_streak` con `config.autoClaimOnLogin
   * = true` y dispara claim para cada una. Fail-soft: si una falla,
   * loguea y continúa (no rompe el login ni los otros claims).
   */
  async autoClaimOnLogin(
    db: TenantDb,
    userId: string,
  ): Promise<ClaimResult[]> {
    // Filtramos en SQL por `config->>'autoClaimOnLogin' = 'true'` para
    // no traer todas y filtrar en memoria. Postgres índice GIN sobre
    // jsonb haría esta query rápida si crece volumen; por ahora MVP
    // (pocas promotions activas) el seq scan es fine.
    const promos = await db
      .select()
      .from(promotionsTable)
      .where(
        and(
          eq(promotionsTable.type, 'login_streak'),
          eq(promotionsTable.status, 'active'),
          sql`(${promotionsTable.config} ->> 'autoClaimOnLogin') = 'true'`,
        ),
      );

    const results: ClaimResult[] = [];
    for (const promo of promos) {
      try {
        const res = await this.claim(db, { promotionId: promo.id, userId });
        results.push(res);
      } catch (err) {
        this.logger.warn(
          `autoClaimOnLogin fallo para promo=${promo.code} user=${userId}: ${(err as Error).message}`,
        );
      }
    }
    return results;
  }

  // ──────────────────────────────────────────────────────────────────────
  // Helpers
  // ──────────────────────────────────────────────────────────────────────

  /** Carga el participant o crea uno fresh (streak=0, no lastClaimDay). */
  private async loadOrCreateParticipant(
    db: TenantDb,
    promotionId: string,
    userId: string,
  ): Promise<{ id: string; currentProgress: unknown }> {
    const existing = await db
      .select()
      .from(promotionParticipants)
      .where(
        and(
          eq(promotionParticipants.promotionId, promotionId),
          eq(promotionParticipants.userId, userId),
        ),
      )
      .limit(1);
    if (existing[0]) return existing[0];

    const values: NewPromotionParticipant = {
      promotionId,
      userId,
      currentProgress: {},
    };
    try {
      const inserted = await db
        .insert(promotionParticipants)
        .values(values)
        .returning();
      return inserted[0]!;
    } catch (err: unknown) {
      // Race: otro request creó la fila. Releemos.
      if (isUniqueViolation(err)) {
        const re = await db
          .select()
          .from(promotionParticipants)
          .where(
            and(
              eq(promotionParticipants.promotionId, promotionId),
              eq(promotionParticipants.userId, userId),
            ),
          )
          .limit(1);
        if (re[0]) return re[0];
      }
      throw err;
    }
  }

  private parseConfig(promo: Promotion): StreakConfig {
    const config = (promo.config ?? {}) as Partial<StreakConfig>;
    if (!Array.isArray(config.prizes) || config.prizes.length === 0) {
      throw new Error(`login_streak config.prizes vacío o ausente (promo=${promo.code})`);
    }
    return {
      prizes: config.prizes,
      forgivenessDays: Math.max(0, Math.floor(config.forgivenessDays ?? 0)),
      onMax: config.onMax ?? 'hold',
      autoClaimOnLogin: !!config.autoClaimOnLogin,
    };
  }

  /**
   * Computa el nuevo streak basado en `prevStreak`, `prevLastDay` (puede
   * ser undefined si nunca claim), y `todayAnchor`.
   *
   * Si daysDiff = 0 → returns prevStreak (caller maneja idempotency
   * antes; este caso ocurre raro vía race).
   */
  private computeNewStreak(
    prevStreak: number,
    prevLastDay: string | undefined,
    todayAnchor: string,
    config: StreakConfig,
  ): number {
    if (!prevLastDay) return 1;
    const daysDiff = this.daysBetween(prevLastDay, todayAnchor);
    if (daysDiff === 0) return prevStreak; // mismo día (idempotency)
    if (daysDiff < 0) {
      // Edge case: lastClaimDay > today (reloj para atrás). Tratamos
      // como reset.
      this.logger.warn(`prevLastDay > today: ${prevLastDay} > ${todayAnchor}. Reset streak.`);
      return 1;
    }
    // forgivenessDays = 0 → solo daysDiff=1 cuenta.
    // forgivenessDays = N → daysDiff ∈ [1, 1+N] cuenta.
    if (daysDiff <= 1 + (config.forgivenessDays ?? 0)) {
      return prevStreak + 1;
    }
    return 1; // reset
  }

  private resolvePrizeIndex(streak: number, config: StreakConfig): number {
    const N = config.prizes.length;
    const idx0 = streak - 1; // 1-indexed → 0-indexed
    if (idx0 < N) return idx0;
    switch (config.onMax) {
      case 'cycle':
        return idx0 % N;
      case 'reset':
        return 0; // ya el caller debería tener streak=1, pero defensivo
      case 'hold':
      default:
        return N - 1;
    }
  }

  private assertWithinSchedule(promo: Promotion, now: Date): void {
    if (promo.startsAt && now.getTime() < promo.startsAt.getTime()) {
      throw new PromotionScheduleClosedError(promo.id);
    }
    if (promo.endsAt && now.getTime() >= promo.endsAt.getTime()) {
      throw new PromotionScheduleClosedError(promo.id);
    }
  }

  /** Diferencia de días calendario entre dos fechas YYYY-MM-DD. */
  private daysBetween(a: string, b: string): number {
    const tA = Date.parse(`${a}T00:00:00Z`);
    const tB = Date.parse(`${b}T00:00:00Z`);
    return Math.round((tB - tA) / MS_PER_DAY);
  }

  private dayAnchor(now: Date): string {
    return now.toISOString().slice(0, 10);
  }
}

