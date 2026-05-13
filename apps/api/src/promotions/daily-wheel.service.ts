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

import { Injectable, Logger } from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';
import {
  promotionRewards,
  type NewPromotionReward,
  type Promotion,
  type PromotionReward,
} from '@casino/db';
import type { TenantDb } from '../tenant-resolver/tenant-context';
import { WalletService } from '../wallet/wallet.service';
import { PromotionsService } from './promotions.service';
import {
  PromotionAlreadyClaimedError,
  PromotionNotActiveError,
  PromotionScheduleClosedError,
  PromotionTypeMismatchError,
  WheelConfigInvalidError,
  FunderInsufficientBalanceError,
} from './promotions.errors';
import {
  IdempotencyConflictError,
  InsufficientBalanceError,
} from '../wallet/wallet.errors';

interface WheelSegment {
  id: string;
  label?: string;
  probability: number;
  prize: WheelPrize;
}

type WheelPrize =
  | { kind: 'chips'; amount: number | string }
  | { kind: 'try_again' }
  | { kind: 'bonus'; definitionId: string; amount: number | string }
  | { kind: 'free_spins'; count: number; gameId?: string };

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
  private readonly logger = new Logger(DailyWheelService.name);

  constructor(
    private readonly promotionsService: PromotionsService,
    private readonly walletService: WalletService,
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

    // 2. Idempotency: 1 spin per (user, day UTC).
    const dayAnchor = this.dayAnchor(now);
    const idempotencyKey = `daily_spin:${params.userId}:${dayAnchor}`;

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
          prize: reward.prize as WheelPrize,
        },
        rng: (reward.metadata as { rng?: number }).rng ?? 0,
      };
    }

    // 3. Sorteo: weighted random sobre segments.
    const rngValue = rng();
    const winningSegment = this.pickSegment(segments, rngValue);

    // 4. Premio.
    const { walletTxId } = await this.awardPrize(db, {
      promo,
      userId: params.userId,
      prize: winningSegment.prize,
      idempotencyKey,
    });

    // 5. Insert reward row.
    const newRow: NewPromotionReward = {
      promotionId: promo.id,
      userId: params.userId,
      prize: winningSegment.prize,
      walletTxId: walletTxId ?? null,
      bonusId: null,
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

  /**
   * Materializa el premio:
   *   - `chips`: debit funder + credit user. Retorna el walletTxId del CREDIT
   *     (el del user) — es el que linkea con reward.walletTxId.
   *   - `try_again`: no-op, sin walletTxId.
   *   - `bonus` / `free_spins`: TODO (logueamos + sin awarding por ahora).
   */
  private async awardPrize(
    db: TenantDb,
    params: {
      promo: Promotion;
      userId: string;
      prize: WheelPrize;
      idempotencyKey: string;
    },
  ): Promise<{ walletTxId: string | null }> {
    const { promo, userId, prize, idempotencyKey } = params;
    if (prize.kind === 'try_again') {
      return { walletTxId: null };
    }

    if (prize.kind === 'chips') {
      const amount = this.numericAsString(prize.amount);
      const funderWallet = await this.walletService.getOrCreateWalletForUser(
        db,
        promo.fundedByUserId,
      );
      const userWallet = await this.walletService.getOrCreateWalletForUser(
        db,
        userId,
      );

      // Debit funder.
      try {
        await this.walletService.executePromotionFunding(db, {
          walletId: funderWallet.id,
          amount,
          idempotencyKey: `promo_fund:${idempotencyKey}`,
          actorUserId: promo.fundedByUserId,
          reason: `Funding promotion ${promo.code} spin`,
          counterpartyUserId: userId,
          referenceId: promo.id,
        });
      } catch (err) {
        if (err instanceof InsufficientBalanceError) {
          throw new FunderInsufficientBalanceError(
            promo.fundedByUserId,
            amount,
            err.available,
          );
        }
        if (err instanceof IdempotencyConflictError) {
          // Si la wallet tx ya existía con params distintos, propagamos.
          throw new PromotionAlreadyClaimedError(idempotencyKey);
        }
        throw err;
      }

      // Credit user.
      const creditTx = await this.walletService.executePromotionReward(db, {
        walletId: userWallet.id,
        amount,
        idempotencyKey: `promo_reward:${idempotencyKey}`,
        actorUserId: promo.fundedByUserId,
        reason: `Promotion ${promo.code} prize`,
        counterpartyUserId: promo.fundedByUserId,
        referenceId: promo.id,
      });
      return { walletTxId: creditTx.id };
    }

    // bonus / free_spins → TODO. Log + skip awarding por ahora.
    this.logger.warn(
      `Premio kind=${prize.kind} aún no implementado — promo=${promo.code} user=${userId}`,
    );
    return { walletTxId: null };
  }

  private numericAsString(v: number | string): string {
    if (typeof v === 'number') return v.toFixed(2);
    // Si llega como "100" sin decimales, normalizar a "100.00" no es
    // necesario — el wallet acepta cualquier representación numeric válida.
    return v;
  }
}
