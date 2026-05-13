/**
 * PromotionPrizeAwarder — helper compartido para materializar premios
 * de cualquier promotion type (daily_wheel, login_streak, lottery, etc.).
 *
 * Pasa el premio descriptor `{kind, ...}` → ejecuta el wallet flow
 * correspondiente:
 *   - `chips`: debit funder (tipo bonus_funding source=promo_funding) +
 *     credit user (tipo promo_reward). Retorna walletTxId del credit.
 *   - `try_again`: no-op.
 *   - `bonus`: TODO (futuro: wireup con UserBonusesService).
 *   - `free_spins`: TODO (necesita game engine).
 *
 * Idempotency keys derivadas del key base que provee el caller (cada
 * type construye su key según su lógica de "una vez por X").
 *
 * Centralizar acá garantiza:
 *   - Mismo wallet semantics para todos los types.
 *   - Si en el futuro cambiamos la mecánica del payout (e.g. agregamos
 *     fund_reservations), un solo lugar tocás.
 */

import { Injectable, Logger } from '@nestjs/common';
import type { Promotion } from '@casino/db';
import type { TenantDb } from '../tenant-resolver/tenant-context';
import { WalletService } from '../wallet/wallet.service';
import {
  IdempotencyConflictError,
  InsufficientBalanceError,
} from '../wallet/wallet.errors';
import {
  FunderInsufficientBalanceError,
  PromotionAlreadyClaimedError,
} from './promotions.errors';

export type PromotionPrize =
  | { kind: 'chips'; amount: number | string }
  | { kind: 'try_again' }
  | { kind: 'bonus'; definitionId: string; amount: number | string }
  | { kind: 'free_spins'; count: number; gameId?: string };

export interface AwardResult {
  /** Id de la wallet_tx que credita al user. NULL si no hay (try_again, etc.). */
  walletTxId: string | null;
  /** Id del user_bonus si el premio fue otorgar un bono. NULL en otros casos. */
  bonusId: string | null;
}

@Injectable()
export class PromotionPrizeAwarder {
  private readonly logger = new Logger(PromotionPrizeAwarder.name);

  constructor(private readonly walletService: WalletService) {}

  /**
   * Materializa un premio. `idempotencyKeyBase` es la clave del evento
   * que dispara el award (e.g. `daily_spin:<userId>:<dayAnchor>`).
   * Generamos sub-keys derivadas para los wallet_tx.
   */
  async award(
    db: TenantDb,
    params: {
      promo: Promotion;
      userId: string;
      prize: PromotionPrize;
      idempotencyKeyBase: string;
    },
  ): Promise<AwardResult> {
    const { promo, userId, prize, idempotencyKeyBase } = params;

    if (prize.kind === 'try_again') {
      return { walletTxId: null, bonusId: null };
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

      try {
        await this.walletService.executePromotionFunding(db, {
          walletId: funderWallet.id,
          amount,
          idempotencyKey: `promo_fund:${idempotencyKeyBase}`,
          actorUserId: promo.fundedByUserId,
          reason: `Funding promotion ${promo.code}`,
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
          throw new PromotionAlreadyClaimedError(idempotencyKeyBase);
        }
        throw err;
      }

      const creditTx = await this.walletService.executePromotionReward(db, {
        walletId: userWallet.id,
        amount,
        idempotencyKey: `promo_reward:${idempotencyKeyBase}`,
        actorUserId: promo.fundedByUserId,
        reason: `Promotion ${promo.code} prize`,
        counterpartyUserId: promo.fundedByUserId,
        referenceId: promo.id,
      });
      return { walletTxId: creditTx.id, bonusId: null };
    }

    // bonus / free_spins → TODO. Log + skip awarding.
    this.logger.warn(
      `Premio kind=${prize.kind} aún no implementado — promo=${promo.code} user=${userId}`,
    );
    return { walletTxId: null, bonusId: null };
  }

  private numericAsString(v: number | string): string {
    return typeof v === 'number' ? v.toFixed(2) : v;
  }
}
