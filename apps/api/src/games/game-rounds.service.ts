/**
 * GameRoundsService — orquesta el ciclo bet/settle/rollback de un round.
 *
 * Sprint 35. Flujo `placeBetAndSettle` (mock síncrono):
 *   1. Validación: session activa, ownership, bet en [minBet, maxBet]
 *      del game.config.
 *   2. Responsible gaming: `assertCanBet` (exclusion + betLimitPerRound +
 *      lossLimitPeriod).
 *   3. Genera `roundExternalId` (UUID interno — para provider real
 *      vendría del adapter).
 *   4. Idempotency check: si ya existe `(sessionId, roundExternalId)`,
 *      devolver el round existente (defensa contra retry del cliente).
 *   5. Wallet debit type='bet' con idempotencyKey `game_bet:<sessionId>:<roundExternalId>`.
 *   6. Provider.settleRound → winAmount + payload.
 *   7. Si winAmount > 0: wallet credit type='win' con idempotencyKey
 *      `game_win:<sessionId>:<roundExternalId>`.
 *   8. Insert `game_round` con status='settled', wallet_tx_ids linkeados,
 *      payload del provider.
 *
 * Todo dentro de una sola TX postgres → atómico. Si algo falla, rollback
 * completo (wallet vuelve, round NO se persiste).
 *
 * `rollbackRound` (admin debug / error transient): refund del bet,
 * marca status='rolled_back'. Idempotente.
 */

import { Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import {
  gameRounds,
  generateUuidV7,
  type GameRound,
  type GameSession,
  type NewGameRound,
} from '@casino/db';
import { BettingCapsService } from '../house/betting-caps.service';
import { HouseInsufficientForWinError } from '../house/house.errors';
import { HouseService } from '../house/house.service';
import { ResponsibleGamingService } from '../responsible-gaming/responsible-gaming.service';
import type { TenantDb } from '../tenant-resolver/tenant-context';
import { InsufficientBalanceError } from '../wallet/wallet.errors';
import { WalletService } from '../wallet/wallet.service';
import { GamesService } from './games.service';
import {
  GameBetOutOfRangeError,
  GameRoundAlreadySettledError,
  GameRoundNotFoundError,
} from './game-rounds.errors';
import {
  GameSessionNotActiveError,
  GameSessionUserMismatchError,
} from './game-sessions.errors';
import { GameProviderRegistry } from './providers/game-provider.registry';

export interface PlaceBetParams {
  session: GameSession;
  actorUserId: string;
  betAmount: string;
  /** RNG override para tests determinísticos del provider mock. */
  rng?: () => number;
}

export interface RollbackParams {
  roundId: string;
  actorUserId: string;
  reason: string;
}

@Injectable()
export class GameRoundsService {
  constructor(
    private readonly providers: GameProviderRegistry,
    private readonly gamesService: GamesService,
    private readonly walletService: WalletService,
    private readonly responsibleGaming: ResponsibleGamingService,
    private readonly bettingCaps: BettingCapsService,
    private readonly house: HouseService,
  ) {}

  /**
   * Coloca un bet y lo settlea en un solo flow (mock síncrono).
   *
   * Para provider real (futuro async): split en `placeBet` + worker que
   * espera evento del provider y llama `settleRound` por separado.
   * MVP: síncrono.
   */
  async placeBetAndSettle(
    db: TenantDb,
    params: PlaceBetParams,
  ): Promise<GameRound> {
    // 1. Validar session activa + ownership.
    if (params.session.status !== 'active') {
      throw new GameSessionNotActiveError(params.session.id);
    }
    if (params.session.userId !== params.actorUserId) {
      throw new GameSessionUserMismatchError(
        params.session.id,
        params.actorUserId,
      );
    }

    // 2. Cargar game + validar rango de bet.
    const game = await this.gamesService.findById(db, params.session.gameId);
    const cfg = game.config as
      | { minBet?: string | number; maxBet?: string | number }
      | null;
    const minBet = cfg?.minBet != null ? String(cfg.minBet) : null;
    const maxBet = cfg?.maxBet != null ? String(cfg.maxBet) : null;
    const betCents = toCents(params.betAmount);
    if (!Number.isFinite(betCents) || betCents <= 0) {
      throw new GameBetOutOfRangeError(params.betAmount, minBet, maxBet);
    }
    if (minBet && betCents < toCents(minBet)) {
      throw new GameBetOutOfRangeError(params.betAmount, minBet, maxBet);
    }
    if (maxBet && betCents > toCents(maxBet)) {
      throw new GameBetOutOfRangeError(params.betAmount, minBet, maxBet);
    }

    // 3. Responsible gaming: exclusion + bet/loss caps.
    await this.responsibleGaming.assertCanBet(
      db,
      params.actorUserId,
      params.betAmount,
    );

    // 3.5. Topes de apuesta (B-build-4b): BLOQUEA si la apuesta superaría el
    //      turnover mensual permitido (por jugador o global). Protege la
    //      exposición ante bugs/fraude (ej. comisión del provider externo).
    await this.bettingCaps.assertWithinCaps(
      db,
      params.actorUserId,
      params.betAmount,
    );

    // 4. Generar roundExternalId (UUID v7 — único + ordenable).
    //    Provider real: el adapter lo asignaría. Mock: lo generamos acá.
    const roundExternalId = generateUuidV7();

    // 5. Idempotency check (defensa contra retry — el wallet ya hace su
    //    propio check, esto es belt-and-suspenders).
    const existing = await db
      .select()
      .from(gameRounds)
      .where(
        and(
          eq(gameRounds.sessionId, params.session.id),
          eq(gameRounds.roundExternalId, roundExternalId),
        ),
      )
      .limit(1);
    if (existing[0]) return existing[0];

    return db.transaction(async (tx) => {
      const txDb = tx as unknown as TenantDb;

      // 6. Wallet debit (bet).
      const wallet = await this.walletService.getOrCreateWalletForUser(
        txDb,
        params.actorUserId,
      );
      const betWalletTx = await this.walletService.placeBet(txDb, {
        walletId: wallet.id,
        amount: params.betAmount,
        sessionId: params.session.id,
        roundExternalId,
        actorUserId: params.actorUserId,
      });

      // 6.5. bet → Casa (B-build-4a): la apuesta va a la Casa (no se "destruye").
      const houseWallet = await this.house.getHouseWallet(txDb);
      await this.walletService.houseTakeBet(txDb, {
        houseWalletId: houseWallet.id,
        amount: params.betAmount,
        sessionId: params.session.id,
        roundExternalId,
        actorUserId: params.actorUserId,
        counterpartyUserId: params.actorUserId,
        relatedTxId: betWalletTx.id,
      });

      // 7. Provider settle (RNG).
      const provider = this.providers.get(game.providerCode);
      const settle = await provider.settleRound({
        game,
        userId: params.actorUserId,
        betAmount: params.betAmount,
        roundExternalId,
        rng: params.rng,
      });

      // 8. Si win, wallet credit (win).
      let winWalletTxId: string | null = null;
      const winCents = toCents(settle.winAmount);
      if (winCents > 0) {
        const winTx = await this.walletService.settleWin(txDb, {
          walletId: wallet.id,
          amount: settle.winAmount,
          sessionId: params.session.id,
          roundExternalId,
          actorUserId: params.actorUserId,
        });
        winWalletTxId = winTx.id;

        // 8.5. win ← Casa (B-build-4a, estricto): el premio sale de la Casa.
        //      Si la Casa no tiene fondos, voidea el round (rollback atómico de
        //      toda la TX, incluido el bet) y avisa — hay que aportar capital.
        try {
          await this.walletService.housePayWin(txDb, {
            houseWalletId: houseWallet.id,
            amount: settle.winAmount,
            sessionId: params.session.id,
            roundExternalId,
            actorUserId: params.actorUserId,
            counterpartyUserId: params.actorUserId,
            relatedTxId: winTx.id,
          });
        } catch (err) {
          if (err instanceof InsufficientBalanceError) {
            throw new HouseInsufficientForWinError(settle.winAmount);
          }
          throw err;
        }
      }

      // 9. Compute net + insert round.
      const netCents = winCents - betCents;
      const values: NewGameRound = {
        sessionId: params.session.id,
        userId: params.actorUserId,
        gameId: game.id,
        roundExternalId,
        betAmount: params.betAmount,
        winAmount: settle.winAmount,
        netAmount: fromCents(netCents),
        status: 'settled',
        betWalletTxId: betWalletTx.id,
        winWalletTxId,
        payload: settle.payload,
        settledAt: new Date(),
      };
      const inserted = await tx
        .insert(gameRounds)
        .values(values)
        .returning();
      return inserted[0]!;
    });
  }

  async findById(db: TenantDb, id: string): Promise<GameRound> {
    const rows = await db
      .select()
      .from(gameRounds)
      .where(eq(gameRounds.id, id))
      .limit(1);
    if (!rows[0]) throw new GameRoundNotFoundError(id);
    return rows[0];
  }

  /**
   * Rollback de un round settled. Refund del bet via wallet credit
   * type='rollback'. Idempotente: si ya está rolled_back, no hace nada.
   */
  async rollbackRound(
    db: TenantDb,
    params: RollbackParams,
  ): Promise<GameRound> {
    return db.transaction(async (tx) => {
      const txDb = tx as unknown as TenantDb;
      const rows = await tx
        .select()
        .from(gameRounds)
        .where(eq(gameRounds.id, params.roundId))
        .for('update')
        .limit(1);
      const round = rows[0];
      if (!round) throw new GameRoundNotFoundError(params.roundId);
      if (round.status === 'rolled_back') return round; // idempotente
      if (round.status !== 'settled') {
        throw new GameRoundAlreadySettledError(params.roundId);
      }

      const wallet = await this.walletService.getOrCreateWalletForUser(
        txDb,
        round.userId,
      );

      // Refund neto: si ganó (net > 0), el rollback debita el net
      // entregado. Si perdió (net < 0), el rollback credita el bet.
      // Caso simple: refund = bet amount (revertir el bet original).
      // Si había win, también lo revertimos. Hacemos un único wallet_tx
      // de tipo 'rollback' por el monto NETO inverso.
      const netCents = toCents(round.netAmount);
      const refundCents = -netCents; // si net=-100, refund=+100. Si net=+200, refund=-200.

      let rollbackTxId: string | null = null;
      if (refundCents !== 0) {
        const rollbackTx = await this.walletService.executeGameRollback(txDb, {
          walletId: wallet.id,
          amount: fromCents(Math.abs(refundCents)),
          direction: refundCents > 0 ? 'credit' : 'debit',
          sessionId: round.sessionId,
          roundExternalId: round.roundExternalId,
          actorUserId: params.actorUserId,
          reason: params.reason,
        });
        rollbackTxId = rollbackTx.id;
      }

      // Casa rollback (B-build-4a): reversa de la posición de la Casa en el
      // round (opuesta al neto del jugador). netCents>0 (el jugador ganó) → la
      // Casa recupera lo que pagó (credit); netCents<0 (perdió) → la Casa
      // devuelve el bet que tomó (debit).
      if (netCents !== 0) {
        const houseWallet = await this.house.getHouseWallet(txDb);
        await this.walletService.houseRollback(txDb, {
          houseWalletId: houseWallet.id,
          amount: fromCents(Math.abs(netCents)),
          direction: netCents > 0 ? 'credit' : 'debit',
          sessionId: round.sessionId,
          roundExternalId: round.roundExternalId,
          actorUserId: params.actorUserId,
          reason: params.reason,
        });
      }

      // Notificar al provider (mock es no-op).
      const game = await this.gamesService.findById(txDb, round.gameId);
      const provider = this.providers.get(game.providerCode);
      await provider.rollback({
        roundExternalId: round.roundExternalId,
        reason: params.reason,
      });

      const updated = await tx
        .update(gameRounds)
        .set({
          status: 'rolled_back',
          rollbackWalletTxId: rollbackTxId,
          rolledBackAt: new Date(),
        })
        .where(eq(gameRounds.id, params.roundId))
        .returning();
      return updated[0]!;
    });
  }

  async listForSession(
    db: TenantDb,
    sessionId: string,
    limit = 50,
  ): Promise<GameRound[]> {
    return db
      .select()
      .from(gameRounds)
      .where(eq(gameRounds.sessionId, sessionId))
      .orderBy(gameRounds.placedAt)
      .limit(limit);
  }
}

// ──────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────

function toCents(value: string): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return NaN;
  return Math.round(n * 100);
}

function fromCents(cents: number): string {
  return (cents / 100).toFixed(2);
}
