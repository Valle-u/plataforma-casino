/**
 * DailyWheelService — lógica del giro de ruleta diaria.
 *
 * Config esperada:
 *   {
 *     "segments": [
 *       { "id": "s1", "label": "100 fichas", "probability": 0.4,
 *         "prize": { "kind": "chips", "amount": 100 } },
 *       { "id": "s2", "label": "Try again", "probability": 0.3,
 *         "prize": { "kind": "try_again" } },
 *       ...
 *     ]
 *   }
 *
 * Reglas:
 *   - `probability` numérico > 0. La suma DEBE ser 1.0 ± epsilon (o 100
 *     ± epsilon — auto-detectado por escala).
 *   - 1 spin/día/user enforced via idempotency key
 *     `daily_spin:<userId>:<dayAnchor>`. dayAnchor = UTC date YYYY-MM-DD.
 *   - El service NO valida la elegibilidad del user contra
 *     `targetSegment` por ahora (igual que bonos — sprint futuro).
 *   - Premios MVP soportados:
 *     - `chips`: debit funder + credit user via wallet_tx `promo_reward`.
 *     - `try_again`: no chips, registra el spin igual.
 *     - `bonus`: TODO (futuro) — link a definitionId via UserBonusesService.
 *     - `free_spins`: TODO — necesita engine de juegos.
 *
 * Diseño:
 *   - El sorteo se hace IN-SERVICE (no en DB). RNG seedeable para tests
 *     (`spinAt(rng)`).
 *   - El registro en `promotion_rewards` incluye `metadata.rng` con el
 *     valor random usado (verificable post-hoc por auditoría).
 */

import { Injectable } from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';
import {
  promotionRewards,
  type NewPromotionReward,
  type Promotion,
  type PromotionReward,
} from '@casino/db';
import type { TenantDb } from '../tenant-resolver/tenant-context';
import {
  PromotionPrizeAwarder,
  type PromotionPrize,
} from './prize-awarder.service';
import { PromotionsService } from './promotions.service';
import {
  PromotionAlreadyClaimedError,
  PromotionNotActiveError,
  PromotionScheduleClosedError,
  PromotionTypeMismatchError,
  WheelConfigInvalidError,
} from './promotions.errors';

interface WheelSegment {
  id: string;
  label?: string;
  probability: number;
  prize: PromotionPrize;
}

interface WheelConfig {
  segments: WheelSegment[];
}

export interface SpinResult {
  reward: PromotionReward;
  segment: WheelSegment;
  /** Random value used (0..1). Util para tests y auditoría. */
  rng: number;
}

/** Inyectable de RNG. Tests pasan uno determinístico. */
export type WheelRng = () => number;

@Injectable()
export class DailyWheelService {
  constructor(
    private readonly promotionsService: PromotionsService,
    private readonly prizeAwarder: PromotionPrizeAwarder,
  ) {}

  /**
   * Procesa un giro de ruleta para `userId` sobre `promotionId`. Si el
   * user ya giró hoy, retorna el reward existente (idempotente).
   *
   * `rng` opcional permite tests determinísticos (defecto: `Math.random`).
   * `nowProvider` opcional para test del día anchor.
   */
  async spin(
    db: TenantDb,
    params: {
      promotionId: string;
      userId: string;
    },
    options: {
      rng?: WheelRng;
      now?: Date;
    } = {},
  ): Promise<SpinResult> {
    const rng = options.rng ?? Math.random;
    const now = options.now ?? new Date();

    // 1. Cargar promotion + validar.
    const promo = await this.promotionsService.findById(db, params.promotionId);
    if (promo.type !== 'daily_wheel') {
      throw new PromotionTypeMismatchError(promo.id, 'daily_wheel', promo.type);
    }
    if (promo.status !== 'active') {
      throw new PromotionNotActiveError(promo.id, promo.status);
    }
    this.assertWithinSchedule(promo, now);

    const segments = this.parseConfig(promo);

    // 2. Idempotency: 1 spin per (promotion, user, day UTC). Incluimos
    //    `promo.id` en la key para que los wallet_tx derivados sean
    //    únicos globalmente (si un user tiene 2 wheel activos el mismo
    //    día, los wallet keys no colisionan).
    const dayAnchor = this.dayAnchor(now);
    const idempotencyKey = `daily_spin:${promo.id}:${params.userId}:${dayAnchor}`;

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
      const segId = (reward.metadata as { segmentId?: string }).segmentId;
      const seg = segments.find((s) => s.id === segId);
      // Si no encontramos el segment (e.g. config cambió post-spin),
      // retornamos uno sintético inferido del prize guardado. Mejor que
      // tirar — el reward histórico es la verdad.
      return {
        reward,
        segment: seg ?? {
          id: segId ?? 'unknown',
          probability: 0,
          prize: reward.prize as PromotionPrize,
        },
        rng: (reward.metadata as { rng?: number }).rng ?? 0,
      };
    }

    // 3. Sorteo: weighted random sobre segments.
    const rngValue = rng();
    const winningSegment = this.pickSegment(segments, rngValue);

    // 4. Premio (vía helper compartido).
    const { walletTxId, bonusId } = await this.prizeAwarder.award(db, {
      promo,
      userId: params.userId,
      prize: winningSegment.prize,
      idempotencyKeyBase: idempotencyKey,
    });

    // 5. Insert reward row.
    const newRow: NewPromotionReward = {
      promotionId: promo.id,
      userId: params.userId,
      prize: winningSegment.prize,
      walletTxId: walletTxId ?? null,
      bonusId: bonusId ?? null,
      idempotencyKey,
      metadata: {
        kind: 'daily_wheel',
        segmentId: winningSegment.id,
        dayAnchor,
        rng: rngValue,
      },
    };
    let reward: PromotionReward;
    try {
      const inserted = await db
        .insert(promotionRewards)
        .values(newRow)
        .returning();
      reward = inserted[0]!;
    } catch (err: unknown) {
      // Race: otro request con misma key ganó. Releemos.
      if (
        err instanceof Error &&
        'code' in err &&
        (err as { code: string }).code === '23505'
      ) {
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
          // Devolvemos el reward existente (el wallet tx también es idempotent).
          throw new PromotionAlreadyClaimedError(idempotencyKey);
        }
      }
      throw err;
    }

    return { reward, segment: winningSegment, rng: rngValue };
  }

  /** Historial del user en una promotion. */
  async listMyRewards(
    db: TenantDb,
    promotionId: string,
    userId: string,
    limit = 50,
    offset = 0,
  ): Promise<PromotionReward[]> {
    return db
      .select()
      .from(promotionRewards)
      .where(
        and(
          eq(promotionRewards.promotionId, promotionId),
          eq(promotionRewards.userId, userId),
        ),
      )
      .orderBy(desc(promotionRewards.grantedAt))
      .limit(limit)
      .offset(offset);
  }

  // ──────────────────────────────────────────────────────────────────────
  // Internals
  // ──────────────────────────────────────────────────────────────────────

  private parseConfig(promo: Promotion): WheelSegment[] {
    const config = promo.config as Partial<WheelConfig>;
    if (!Array.isArray(config.segments) || config.segments.length === 0) {
      throw new WheelConfigInvalidError('config.segments vacío o ausente');
    }
    const segments = config.segments;
    let total = 0;
    for (const s of segments) {
      if (typeof s.probability !== 'number' || s.probability <= 0) {
        throw new WheelConfigInvalidError(`segment '${s.id}' probability inválida`);
      }
      total += s.probability;
    }
    // Aceptamos suma=1 o suma=100 (auto-detect). Tolerancia 1% para
    // permitir redondeos del admin.
    if (Math.abs(total - 1) > 0.01 && Math.abs(total - 100) > 1) {
      throw new WheelConfigInvalidError(
        `sum(probability)=${total} (esperado ~1.0 o ~100)`,
      );
    }
    // Normalizamos a escala 1.0.
    const scale = total > 5 ? 100 : 1;
    return segments.map((s) => ({
      ...s,
      probability: s.probability / scale,
    }));
  }

  /** Weighted random pick. `rngValue` ∈ [0,1). */
  private pickSegment(segments: WheelSegment[], rngValue: number): WheelSegment {
    let cumulative = 0;
    for (const s of segments) {
      cumulative += s.probability;
      if (rngValue < cumulative) return s;
    }
    // Fallback (suma < 1 por redondeo) — devolvemos el último.
    return segments[segments.length - 1]!;
  }

  private assertWithinSchedule(promo: Promotion, now: Date): void {
    if (promo.startsAt && now.getTime() < promo.startsAt.getTime()) {
      throw new PromotionScheduleClosedError(promo.id);
    }
    if (promo.endsAt && now.getTime() >= promo.endsAt.getTime()) {
      throw new PromotionScheduleClosedError(promo.id);
    }
  }

  /** 'YYYY-MM-DD' UTC del momento. Bucket diario. */
  private dayAnchor(now: Date): string {
    return now.toISOString().slice(0, 10);
  }

}
