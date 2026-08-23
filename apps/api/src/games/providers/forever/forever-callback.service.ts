/**
 * ForeverCallbackService — procesa el callback seamless de Forever.
 *
 * 2 métodos:
 *   - GetBalance   → devuelve el saldo jugable del jugador.
 *   - ChangeBalance → mueve el saldo según txnType:
 *       0 Debit  (apuesta) → burn (bonus-first)         [resta]
 *       1 Credit (premio)  → mint                        [suma]
 *       2 Cancel (reversa) → mint                        [suma]
 *
 * Economía (LEYES E1/E6, confirmado por el dueño): el `amount` del callback = 1 ficha
 * (sin conversión). Bet = burn puro, win = mint puro (con tope de sanidad),
 * cancel = mint (reversa de la apuesta). El `locked` (retiros en hold) NO es
 * jugable, así que no se reporta.
 *
 * Idempotencia: `forever_transactions.txn_code` UNIQUE + idempotency key del
 * wallet `forever:{txnCode}`. Un callback repetido no re-aplica.
 */

import { Injectable, Logger } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import {
  foreverTransactions,
  gameRounds,
  gameSessions,
  games,
  users,
  wallets,
  generateUuidV7,
  type Wallet,
} from '@casino/db';
import type { TenantDb } from '../../../tenant-resolver/tenant-context';
import { WalletService } from '../../../wallet/wallet.service';
import { NotificationsService } from '../../../notifications/notifications.service';
import { GameProviderLogsService } from '../../game-provider-logs.service';
import { TenantSettingsService } from '../../../tenant-settings/tenant-settings.service';
import { InsufficientBalanceError } from '../../../wallet/wallet.errors';
import { isUniqueViolation } from '../../../common/pg-error';
import {
  FOREVER_STATUS,
  FOREVER_TXN_TYPE,
  type ForeverCallbackBody,
  type ForeverCallbackResponse,
} from './forever.types';

interface ResolvedContext {
  userId: string;
  userStatus: string;
  wallet: Wallet;
}

@Injectable()
export class ForeverCallbackService {
  private readonly logger = new Logger(ForeverCallbackService.name);

  constructor(
    private readonly walletService: WalletService,
    private readonly providerLogs: GameProviderLogsService,
    private readonly notifications: NotificationsService,
    private readonly settings: TenantSettingsService,
  ) {}

  /** Tope de sanidad del premio (mint). 0 = sin tope. */
  private static readonly DEFAULT_WIN_MAX = 50_000_000;

  async handle(
    db: TenantDb,
    body: ForeverCallbackBody,
  ): Promise<ForeverCallbackResponse> {
    try {
      switch (body.method) {
        case 'GetBalance':
          return await this.handleGetBalance(db, body);
        case 'ChangeBalance':
          return await this.handleChangeBalance(db, body);
        default:
          return { status: FOREVER_STATUS.INVALID_ACTION, msg: 'INVALID_ACTION' };
      }
    } catch (err) {
      if (err instanceof InsufficientBalanceError) {
        return {
          status: FOREVER_STATUS.INSUFFICIENT_MONEY,
          msg: 'INSUFFICIENT_MONEY',
          balance: Number(err.available),
        };
      }
      const errMsg = (err as Error).message;
      this.logger.error(`Error procesando callback '${body.method}': ${errMsg}`);
      await this.providerLogs.write(db, {
        providerCode: 'forever',
        eventType: 'callback_error',
        severity: 'error',
        message: `Error inesperado procesando callback '${body.method}'.`,
        detail: { method: body.method, userCode: body.userCode, txnCode: body.txnCode, error: errMsg },
      });
      return { status: FOREVER_STATUS.INTERNAL_ERROR, msg: 'INTERNAL_ERROR' };
    }
  }

  private async handleGetBalance(
    db: TenantDb,
    body: ForeverCallbackBody,
  ): Promise<ForeverCallbackResponse> {
    const ctx = await this.resolveContext(db, body.userCode ?? '');
    if (!ctx) return { status: FOREVER_STATUS.INVALID_USER, msg: 'INVALID_USER' };
    return { status: FOREVER_STATUS.SUCCESS, msg: 'SUCCESS', balance: Number(this.jugable(ctx.wallet)) };
  }

  private async handleChangeBalance(
    db: TenantDb,
    body: ForeverCallbackBody,
  ): Promise<ForeverCallbackResponse> {
    const txnCode = body.txnCode ?? '';
    if (!txnCode) return { status: FOREVER_STATUS.INVALID_PARAMETER, msg: 'INVALID_PARAMETER' };

    const ctx = await this.resolveContext(db, body.userCode ?? '');
    if (!ctx) return { status: FOREVER_STATUS.INVALID_USER, msg: 'INVALID_USER' };
    if (ctx.userStatus !== 'active') {
      return { status: FOREVER_STATUS.BLOCK_USER, msg: 'BLOCK_USER', balance: Number(this.jugable(ctx.wallet)) };
    }

    // Idempotencia: ¿ya procesamos este txnCode?
    const existing = await db
      .select({ id: foreverTransactions.id })
      .from(foreverTransactions)
      .where(eq(foreverTransactions.txnCode, txnCode))
      .limit(1);
    if (existing[0]) {
      const fresh = await this.walletService.getOrCreateWalletForUser(db, ctx.userId);
      return { status: FOREVER_STATUS.SUCCESS, msg: 'SUCCESS', balance: Number(this.jugable(fresh)) };
    }

    const txnType = Number(body.txnType);
    const amountStr = normalizeAmount(body.amount);
    const key = `forever:${txnCode}`;

    // Capturamos el wallet tx + el "command" para linkearlos en game_rounds.
    let walletTxId: string | null = null;
    let command: 'bet' | 'win' | 'cancel';

    if (txnType === FOREVER_TXN_TYPE.DEBIT) {
      command = 'bet';
      // Apuesta → burn (bonus-first). Insufficient → lo captura el handle().
      if (toCents(amountStr) > 0) {
        const tx = await this.walletService.placeBetWithBonusExternal(db, {
          walletId: ctx.wallet.id,
          amount: amountStr,
          idempotencyKey: key,
          source: 'forever_callback',
          reason: `Forever bet ${body.userCode} ${txnCode}`,
        });
        walletTxId = tx.id;
      }
    } else if (txnType === FOREVER_TXN_TYPE.CREDIT) {
      command = 'win';
      // Premio → mint, con tope de sanidad.
      const cap = await this.settings.getNumeric(
        db,
        'game_provider.forever.win_max_amount',
        ForeverCallbackService.DEFAULT_WIN_MAX,
      );
      if (cap > 0 && Number(amountStr) > cap) {
        this.logger.error(
          `Forever WIN RECHAZADO por tope: amount=${amountStr} > cap=${cap} user=${body.userCode} txn=${txnCode}`,
        );
        await this.alertWinOverCap(db, amountStr, cap, body.userCode ?? '?');
        return { status: FOREVER_STATUS.INTERNAL_ERROR, msg: 'WIN_OVER_CAP' };
      }
      if (toCents(amountStr) > 0) {
        const tx = await this.walletService.mintExternal(db, {
          walletId: ctx.wallet.id,
          amount: amountStr,
          idempotencyKey: key,
          source: 'forever_callback',
          reason: `Forever win ${body.userCode} ${txnCode}`,
        });
        walletTxId = tx.id;
      }
    } else if (txnType === FOREVER_TXN_TYPE.CANCEL) {
      command = 'cancel';
      // Cancel = reversa de la apuesta → mint (devuelve el monto).
      if (toCents(amountStr) > 0) {
        const tx = await this.walletService.mintExternal(db, {
          walletId: ctx.wallet.id,
          amount: amountStr,
          idempotencyKey: key,
          source: 'forever_cancel',
          reason: `Forever cancel ${body.userCode} ${txnCode} (wager ${body.wagerId ?? '?'})`,
        });
        walletTxId = tx.id;
      }
    } else {
      return { status: FOREVER_STATUS.INVALID_PARAMETER, msg: 'INVALID_PARAMETER' };
    }

    // Registrar en forever_transactions (idempotencia + auditoría).
    try {
      await db.insert(foreverTransactions).values({
        txnCode,
        userId: ctx.userId,
        userCode: body.userCode ?? '',
        vendorCode: body.vendorCode ?? null,
        txnType,
        sort: txnType === FOREVER_TXN_TYPE.DEBIT ? 'BET' : txnType === FOREVER_TXN_TYPE.CREDIT ? 'WIN' : 'CANCEL',
        wagerId: body.wagerId != null ? String(body.wagerId) : null,
        pairCode: body.pairCode ?? null,
        amount: amountStr,
        gameCode: body.gameCode ?? null,
        gameRoundId: body.gameRoundId ?? null,
        isFreeRound: body.isFreeRound ? 1 : 0,
        providerCreatedOn: body.createdOn ? new Date(body.createdOn) : null,
      });
    } catch (err) {
      // Carrera con un callback idéntico: la key única lo bloquea. El wallet ya
      // es idempotente por `forever:{txnCode}`, así que no hay doble-aplicación.
      if (!isUniqueViolation(err)) throw err;
    }

    // Sync a game_rounds para reporting: netwin / GGR / RTP y comisiones cuentan
    // las jugadas de Forever igual que las de Palace. NO crítico: si falla, la
    // plata ya se movió y quedó registrada en forever_transactions.
    try {
      await this.syncGameRound(db, body, ctx, command, walletTxId);
    } catch (err) {
      this.logger.warn(
        `No se pudo sincronizar game_round de Forever (${txnCode}): ${(err as Error).message}`,
      );
    }

    const updated = await this.walletService.getOrCreateWalletForUser(db, ctx.userId);
    return { status: FOREVER_STATUS.SUCCESS, msg: 'SUCCESS', balance: Number(this.jugable(updated)) };
  }

  // ──────────────────────────────────────────────────────────────────
  // Game rounds sync — puentea los callbacks de Forever → tabla game_rounds
  // para que el reporting (netwin/GGR/RTP/comisiones) cuente las jugadas de
  // Forever. Espejo de PalaceCallbackService.syncGameRound. Aditivo y no
  // crítico. El `wagerId` de Forever liga bet↔win↔cancel (= round_id de Palace).
  // ──────────────────────────────────────────────────────────────────
  private async syncGameRound(
    db: TenantDb,
    body: ForeverCallbackBody,
    ctx: ResolvedContext,
    command: 'bet' | 'win' | 'cancel',
    walletTxId: string | null,
  ): Promise<void> {
    const gameCode = body.gameCode;
    if (!gameCode) return; // sin gameCode no podemos mapear el juego → skip

    // wagerId liga las patas del round (bet/win/cancel). Fallback a gameRoundId.
    const roundExternalId =
      body.wagerId != null ? String(body.wagerId) : (body.gameRoundId ?? '');
    if (!roundExternalId) return;

    // 1. Buscar el juego. Forever guarda vendorCode/gameCode en games.config
    //    (jsonb `config.forever`), no en una columna propia como Palace.
    const [game] = await db
      .select({ id: games.id })
      .from(games)
      .where(
        and(
          sql`${games.config} -> 'forever' ->> 'gameCode' = ${gameCode}`,
          body.vendorCode
            ? sql`${games.config} -> 'forever' ->> 'vendorCode' = ${body.vendorCode}`
            : undefined,
        ),
      )
      .limit(1);
    if (!game) return;

    // 2. Sesión virtual por user+game (mismo patrón que Palace).
    const sessionKey = `forever:${body.userCode ?? ''}:${gameCode}`;
    let [session] = await db
      .select({ id: gameSessions.id })
      .from(gameSessions)
      .where(
        and(
          eq(gameSessions.userId, ctx.userId),
          eq(gameSessions.gameId, game.id),
          eq(gameSessions.providerSessionId, sessionKey),
        ),
      )
      .limit(1);
    if (!session) {
      const id = generateUuidV7();
      await db.insert(gameSessions).values({
        id,
        userId: ctx.userId,
        gameId: game.id,
        providerSessionId: sessionKey,
        status: 'active',
      });
      session = { id };
    }

    // 3. Upsert del game_round por (session, wagerId).
    const amount = normalizeAmount(body.amount);
    const placedAt = body.createdOn ? new Date(body.createdOn) : new Date();
    const payload = body as unknown as Record<string, unknown>;

    if (command === 'bet') {
      const [existing] = await db
        .select({ id: gameRounds.id })
        .from(gameRounds)
        .where(
          and(
            eq(gameRounds.sessionId, session.id),
            eq(gameRounds.roundExternalId, roundExternalId),
          ),
        )
        .limit(1);
      if (!existing) {
        await db.insert(gameRounds).values({
          sessionId: session.id,
          userId: ctx.userId,
          gameId: game.id,
          roundExternalId,
          betAmount: amount,
          winAmount: '0.00',
          netAmount: '0.00',
          status: 'placed',
          betWalletTxId: walletTxId,
          payload,
          placedAt,
        });
      }
    } else if (command === 'win') {
      const [existing] = await db
        .select({ id: gameRounds.id, betAmount: gameRounds.betAmount })
        .from(gameRounds)
        .where(
          and(
            eq(gameRounds.sessionId, session.id),
            eq(gameRounds.roundExternalId, roundExternalId),
          ),
        )
        .limit(1);
      if (existing) {
        const netAmount = (Number(amount) - Number(existing.betAmount)).toFixed(2);
        await db
          .update(gameRounds)
          .set({
            winAmount: amount,
            netAmount,
            status: 'settled',
            winWalletTxId: walletTxId,
            settledAt: new Date(),
          })
          .where(eq(gameRounds.id, existing.id));
      } else {
        // Win sin bet previo (ej. free round): round settled directo.
        await db.insert(gameRounds).values({
          sessionId: session.id,
          userId: ctx.userId,
          gameId: game.id,
          roundExternalId,
          betAmount: '0.00',
          winAmount: amount,
          netAmount: amount,
          status: 'settled',
          winWalletTxId: walletTxId,
          payload,
          placedAt,
          settledAt: new Date(),
        });
      }
    } else if (command === 'cancel') {
      const [existing] = await db
        .select({ id: gameRounds.id })
        .from(gameRounds)
        .where(
          and(
            eq(gameRounds.sessionId, session.id),
            eq(gameRounds.roundExternalId, roundExternalId),
          ),
        )
        .limit(1);
      if (existing) {
        await db
          .update(gameRounds)
          .set({
            status: 'rolled_back',
            rollbackWalletTxId: walletTxId,
            rolledBackAt: new Date(),
          })
          .where(eq(gameRounds.id, existing.id));
      }
    }
  }

  /** Resuelve el jugador por `userCode` (= nuestro username) + su wallet. */
  private async resolveContext(
    db: TenantDb,
    userCode: string,
  ): Promise<ResolvedContext | null> {
    if (!userCode) return null;
    const rows = await db
      .select({
        id: users.id,
        status: users.status,
        walletId: wallets.id,
        balance: wallets.balance,
        bonusBalance: wallets.bonusBalance,
        lockedBalance: wallets.lockedBalance,
        currency: wallets.currency,
      })
      .from(users)
      .leftJoin(wallets, eq(users.id, wallets.userId))
      .where(eq(users.username, userCode))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    let wallet: Wallet;
    if (row.walletId) {
      wallet = {
        id: row.walletId,
        userId: row.id,
        balance: row.balance ?? '0.00',
        bonusBalance: row.bonusBalance ?? '0.00',
        lockedBalance: row.lockedBalance ?? '0.00',
        currency: row.currency ?? 'CHIPS',
        version: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
    } else {
      wallet = await this.walletService.getOrCreateWalletForUser(db, row.id);
    }
    return { userId: row.id, userStatus: row.status, wallet };
  }

  private async alertWinOverCap(
    db: TenantDb,
    amount: string,
    cap: number,
    userCode: string,
  ): Promise<void> {
    try {
      await this.notifications.enqueueForRole(db, {
        roleCode: 'admin_tenant',
        kind: 'game_provider_alert',
        channel: 'in_app',
        payload: {
          title: 'Win rechazado por tope de sanidad (Forever)',
          message: `Se rechazó un premio de ${amount} (tope ${cap}) para ${userCode}. Revisá si es legítimo o un callback comprometido.`,
          providerCode: 'forever',
        },
      });
    } catch (err) {
      this.logger.error(`No se pudo notificar win-over-cap: ${(err as Error).message}`);
    }
  }

  /** Saldo jugable = (balance − locked) + bonus, floor 0. */
  private jugable(
    wallet: Pick<Wallet, 'balance' | 'bonusBalance' | 'lockedBalance'>,
  ): string {
    const cents = Math.max(
      0,
      toCents(wallet.balance) +
        toCents(String(wallet.bonusBalance ?? '0')) -
        toCents(String(wallet.lockedBalance ?? '0')),
    );
    return (cents / 100).toFixed(2);
  }
}

function toCents(value: string | number): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100);
}

function normalizeAmount(value: string | number | undefined): string {
  const n = typeof value === 'number' ? value : Number(value ?? '0');
  if (!Number.isFinite(n)) return '0.00';
  return n.toFixed(2);
}
