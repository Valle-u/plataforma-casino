/**
 * PromotionPrizeAwarder — helper compartido para materializar premios
 * de cualquier promotion type (daily_wheel, login_streak, lottery, etc.).
 *
 * Pasa el premio descriptor `{kind, ...}` → ejecuta el wallet flow
 * correspondiente:
 *   - `chips`: debit funder (tipo bonus_funding source=promo_funding) +
 *     credit user (tipo promo_reward). Retorna walletTxId del credit.
 *   - `try_again`: no-op.
 *   - `bonus`: grant vía UserBonusesService.
 *   - `free_spins`: **no soportado, tira**. Ver `WheelFreeSpinsNotSupportedError`
 *     y `docs/27-ruleta-diaria.md` §15.
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
import { UserBonusesService } from '../bonuses/user-bonuses.service';
import {
  BonusDefinitionNotActiveError,
  BonusDefinitionNotFoundError,
  BonusTargetNotFoundError,
  FunderInsufficientBalanceError as BonusFunderInsufficientBalanceError,
  GrantIdempotencyConflictError,
} from '../bonuses/bonuses.errors';
import type { TenantDb } from '../tenant-resolver/tenant-context';
import { WalletService } from '../wallet/wallet.service';
import {
  IdempotencyConflictError,
  InsufficientBalanceError,
} from '../wallet/wallet.errors';
import {
  FunderInsufficientBalanceError,
  PromotionAlreadyClaimedError,
  WheelFreeSpinsNotSupportedError,
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
  /**
   * Por qué NO se entregó el premio, cuando el awarder decidió no romper.
   * `undefined` si se entregó bien (o si no había nada que entregar).
   *
   * Existe porque el fail-soft del grant de bonos —que sigue siendo el
   * comportamiento de `login_streak` y de las ligas— devolvía `bonusId: null`
   * y nada más. Desde afuera, "no había bono que dar" y "el bono fallaba" se
   * veían idénticos: los dos eran `null`.
   *
   * La ruleta usa esto para marcar el premio como fallido y avisarle al
   * jugador (`docs/27-ruleta-diaria.md` §9). Los demás lo ignoran y siguen
   * como antes — a propósito: cambiarles el comportamiento de rebote sería
   * modificar dos features para arreglar una tercera.
   */
  deliveryError?: string;
}

/**
 * Contexto genérico que origina el premio. Promotion y League ambos
 * proveen estos campos. Permite reusar el awarder entre subsystems sin
 * acoplarse al schema de uno particular.
 */
export interface PrizeContext {
  /** UUID del entity que originó el premio (promotion.id, league.id, etc.). */
  id: string;
  /** Code legible para reasons + reportes. */
  code: string;
  /** Quien paga las fichas. */
  fundedByUserId: string;
}

@Injectable()
export class PromotionPrizeAwarder {
  private readonly logger = new Logger(PromotionPrizeAwarder.name);

  constructor(
    private readonly walletService: WalletService,
    private readonly userBonusesService: UserBonusesService,
  ) {}

  /**
   * Materializa un premio. `context` describe quién origina (Promotion,
   * League, Mission, etc.) — el awarder solo necesita id/code/funder.
   * `idempotencyKeyBase` es la clave del evento que dispara el award
   * (e.g. `daily_spin:<promoId>:<userId>:<dayAnchor>` o
   * `league_settle:<leagueId>:<userId>`). Generamos sub-keys derivadas
   * para los wallet_tx (`promo_fund:<key>`, `promo_reward:<key>`,
   * `promo_bonus:<key>` — los nombres `promo_*` son legacy del primer
   * sprint pero funcionan igual para leagues; se distinguen por el
   * `referenceId` del wallet_tx que apunta al context.id).
   */
  async award(
    db: TenantDb,
    params: {
      context: PrizeContext;
      userId: string;
      prize: PromotionPrize;
      idempotencyKeyBase: string;
    },
  ): Promise<AwardResult> {
    const { context, userId, prize, idempotencyKeyBase } = params;

    if (prize.kind === 'try_again') {
      return { walletTxId: null, bonusId: null };
    }

    if (prize.kind === 'chips') {
      const amount = this.numericAsString(prize.amount);

      const funderWallet = await this.walletService.getOrCreateWalletForUser(
        db,
        context.fundedByUserId,
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
          actorUserId: context.fundedByUserId,
          reason: `Funding promotion ${context.code}`,
          counterpartyUserId: userId,
          referenceId: context.id,
        });
      } catch (err) {
        if (err instanceof InsufficientBalanceError) {
          throw new FunderInsufficientBalanceError(
            context.fundedByUserId,
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
        actorUserId: context.fundedByUserId,
        reason: `Promotion ${context.code} prize`,
        counterpartyUserId: context.fundedByUserId,
        referenceId: context.id,
      });
      return { walletTxId: creditTx.id, bonusId: null };
    }

    if (prize.kind === 'bonus') {
      // Otorga un bono via UserBonusesService. El dinero del bono sale del
      // funder de la BONUS DEFINITION (no del funder del promo) — cada
      // bonus_definition tiene su propio funder al crearse. El actorUserId
      // en el grant es el funder del PROMO (audit trail: "el promo X
      // gatilló este bono"). Si el funder del bonus_definition no tiene
      // saldo, el grant tira y nos lo agarramos fail-soft (log + reward
      // sin bonusId) — el premio queda registrado pero el user NO recibe
      // el bono. El admin lo ve en logs/audit y reconcilia manualmente.
      try {
        const { bonus: granted } = await this.userBonusesService.grantManual(db, {
          actorUserId: context.fundedByUserId,
          userId,
          definitionId: prize.definitionId,
          amount: this.numericAsString(prize.amount),
          reason: `Prize award (${context.code}): bonus grant automático`,
          grantIdempotencyKey: `promo_bonus:${idempotencyKeyBase}`,
          sourceEvent: {
            kind: 'promotion',
            promotionId: context.id,
            promotionCode: context.code,
          },
          // Sprint 51.2: promotion prize awarder es system action
          // (cron / endpoint de claim). El "actor" es el funder del
          // promo, no necesariamente admin_tenant en sí mismo.
          skipActorRoleCheck: true,
        });
        return { walletTxId: null, bonusId: granted.id };
      } catch (err) {
        // Fail-soft: el premio queda registrado en promotion_rewards
        // (con bonusId=null) pero NO entregamos el bono. El user lo nota
        // si intenta ver "mis bonos" — no aparece. El admin lo ve en
        // los logs.
        if (
          err instanceof BonusDefinitionNotFoundError ||
          err instanceof BonusDefinitionNotActiveError ||
          err instanceof BonusTargetNotFoundError ||
          err instanceof BonusFunderInsufficientBalanceError ||
          err instanceof GrantIdempotencyConflictError
        ) {
          this.logger.error(
            `Premio kind=bonus falló — promo=${context.code} user=${userId} ` +
              `definitionId=${prize.definitionId}: ${err.message}`,
          );
          // Se devuelve el motivo, no sólo `null`. Quien llama decide qué
          // hacer: la ruleta marca el premio como fallido y se lo dice al
          // jugador; `login_streak` y las ligas lo ignoran y siguen igual que
          // siempre.
          return { walletTxId: null, bonusId: null, deliveryError: err.message };
        }
        // Errores no esperados: re-tirar.
        throw err;
      }
    }

    // `free_spins` no está implementado (docs/27 §15) y **tira**, no loguea.
    //
    // Antes devolvía `{ walletTxId: null, bonusId: null }` con un warning: el
    // caller escribía el reward igual, la pantalla tiraba el confetti y el
    // jugador no recibía la tirada. Un premio que no se puede pagar tiene que
    // romper el giro, no completarlo a medias — si rompe se ve en el acto, si
    // se completa a medias no se entera nadie.
    //
    // La primera defensa es `parseWheelConfig`, que impide guardar un segmento
    // así. Esto es la segunda, para las configs que ya existan y para cualquier
    // otro origen de premios que no pase por esa validación (ligas, misiones).
    throw new WheelFreeSpinsNotSupportedError();
  }

  private numericAsString(v: number | string): string {
    return typeof v === 'number' ? v.toFixed(2) : v;
  }
}
