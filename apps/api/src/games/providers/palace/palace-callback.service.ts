/**
 * PalaceCallbackService — procesa los 6 commands del callback de Palace.
 *
 * Flujo:
 *   1. El controller valida el Callback-Token contra la DB de control.
 *   2. Resuelve el tenant y obtiene la conexión a su DB.
 *   3. Llama a este service con (db, command, data, checks[]).
 *   4. El service ejecuta los checks, procesa el command, y devuelve
 *      la response que el controller envía de vuelta al proveedor.
 *
 * Modelos económicos (Opción C confirmada por el dueño):
 *   - bet  → burn puro del wallet (type='bet', source='palace_callback')
 *   - win  → mint puro al wallet (type='win', source='palace_callback')
 *   - cancel → reversa del bet o win anterior (type='rollback')
 *
 * Idempotencia:
 *   - trans_guid es UNIQUE en palace_transactions.
 *   - Idempotency key en wallet_transactions: `palace:{trans_guid}`.
 *   - Si llega repetido → check 41 lo detecta y devolvemos balance.
 *
 * Performance:
 *   - runChecks() resuelve user + wallet UNA sola vez.
 *   - Los resultados se pasan a los handlers para evitar queries duplicadas.
 *   - El balance final se computa del wallet.locked, no se re-query.
 */

import { Injectable, Logger } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import {
  gameRounds,
  gameSessions,
  games,
  palaceTransactions,
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
import {
  PALACE_RESULT,
  type PalaceCallbackData,
  type PalaceCallbackResponse,
  type PalaceCommand,
} from './palace.types';
import {
  PalaceAlreadyProcessedError,
  PalaceInsufficientBalanceError,
  PalaceTransactionNotFoundError,
  PalaceUserNotActiveError,
  PalaceUserNotFoundError,
} from './palace.errors';

/** Contexto resuelto por runChecks — reutilizado por handlers. */
interface ResolvedContext {
  userId: string;
  userStatus: string;
  wallet: Wallet;
}

@Injectable()
export class PalaceCallbackService {
  private readonly logger = new Logger(PalaceCallbackService.name);

  constructor(
    private readonly walletService: WalletService,
    private readonly providerLogs: GameProviderLogsService,
    private readonly notifications: NotificationsService,
    private readonly settings: TenantSettingsService,
  ) {}

  /**
   * Tope de sanidad del premio (win). Auditoría económica: un `win` del
   * proveedor se mintea sin límite; un monto absurdo casi seguro es un callback
   * comprometido. Configurable por tenant vía `game_provider.palace.win_max_amount`
   * (fichas). Default generoso (muy por encima de cualquier premio real de este
   * mercado, pero finito) para no bloquear jackpots legítimos. 0 = sin tope.
   */
  private static readonly DEFAULT_WIN_MAX = 50_000_000;

  async handle(
    db: TenantDb,
    command: PalaceCommand,
    data: PalaceCallbackData,
    checks: number[],
  ): Promise<PalaceCallbackResponse> {
    try {
      // ── Ejecutar checks (validaciones previas) ──
      // runChecks ahora devuelve el contexto resuelto (user + wallet)
      // para que los handlers NO tengan que re-queryear.

      const { checkResult, ctx } = await this.runChecks(db, command, data, checks);
      if (checkResult) {
        return checkResult;
      }
      if (!ctx) {
        return { result: PALACE_RESULT.INTERNAL_ERROR, status: 'ERROR' };
      }

      // ── Procesar command ──

      switch (command) {
        case 'authenticate':
          return {
            result: PALACE_RESULT.OK,
            status: 'OK',
            data: {
              account: data.account,
              balance: Number(this.totalBalance(ctx.wallet)),
            },
          };

        case 'balance':
          return this.ok(this.totalBalance(ctx.wallet));

        case 'bet':
          return await this.handleBet(db, data, ctx);

        case 'win':
          return await this.handleWin(db, data, ctx);

        case 'cancel':
          return await this.handleCancel(db, data, ctx);

        case 'status':
          return await this.handleStatus(db, data, ctx);

        default:
          return {
            result: PALACE_RESULT.INTERNAL_ERROR,
            status: 'ERROR',
          };
      }
    } catch (err) {
      // Errores conocidos → devolver balance si lo tenemos
      if (err instanceof PalaceUserNotFoundError) {
        return {
          result: PALACE_RESULT.CHECK_USER_NOT_FOUND,
          status: 'ERROR',
        };
      }
      if (err instanceof PalaceUserNotActiveError) {
        return {
          result: PALACE_RESULT.CHECK_USER_NOT_ACTIVE,
          status: 'ERROR',
        };
      }
      if (err instanceof PalaceInsufficientBalanceError) {
        return {
          result: PALACE_RESULT.CHECK_INSUFFICIENT_BALANCE,
          status: 'ERROR',
          data: { balance: Number(err.balance) },
        };
      }
      // InsufficientBalanceError del WalletService (ej. placeBetWithBonus
      // con saldo disponible 0 por un hold): misma semántica que el check 31.
      if (err instanceof InsufficientBalanceError) {
        return {
          result: PALACE_RESULT.CHECK_INSUFFICIENT_BALANCE,
          status: 'ERROR',
          data: { balance: Number(err.available) },
        };
      }
      if (err instanceof PalaceAlreadyProcessedError) {
        return {
          result: PALACE_RESULT.CHECK_ALREADY_PROCESSED,
          status: 'ERROR',
          data: { balance: err.balance ?? 0 },
        };
      }
      if (err instanceof PalaceTransactionNotFoundError) {
        return {
          result: PALACE_RESULT.CHECK_TX_NOT_FOUND,
          status: 'ERROR',
        };
      }

      // Error inesperado → log + 99. Observabilidad best-effort: registramos
      // en game_provider_logs y alertamos al admin. NO tocamos la lógica de
      // fichas (esto corre en el catch, después de que el command falló).
      const errMsg = (err as Error).message;
      this.logger.error(`Error procesando command '${command}': ${errMsg}`);
      await this.providerLogs.write(db, {
        providerCode: 'palace',
        eventType: 'callback_error',
        severity: 'error',
        message: `Error inesperado procesando callback '${command}'.`,
        detail: {
          command,
          account: data.account,
          transGuid: data.trans_guid ?? null,
          error: errMsg,
        },
      });
      try {
        await this.notifications.enqueueForRole(db, {
          roleCode: 'admin_tenant',
          kind: 'game_provider_alert',
          channel: 'in_app',
          payload: {
            title: 'Error en callback del proveedor',
            message: `Un callback '${command}' de Palace falló: ${errMsg}`,
            providerCode: 'palace',
          },
        });
      } catch {
        // no-op: alertar no debe romper la respuesta al proveedor.
      }
      return {
        result: PALACE_RESULT.INTERNAL_ERROR,
        status: 'ERROR',
      };
    }
  }

  // ──────────────────────────────────────────────────────────────────
  // Checks — ahora devuelven el contexto resuelto
  // ──────────────────────────────────────────────────────────────────

  private async runChecks(
    db: TenantDb,
    command: PalaceCommand,
    data: PalaceCallbackData,
    checks: number[],
  ): Promise<{ checkResult: PalaceCallbackResponse | null; ctx: ResolvedContext | null }> {
    const account = data.account ?? '';

    // Always resolve context (user + wallet) regardless of checks array.
    // When checks is empty (e.g. bet/win without explicit checks), ctx must
    // still be populated for the handler to work.
    let ctx: ResolvedContext | null = null;

    // Resolve user + wallet up-front for account-based commands.
    // Skip if check 21 is present — it does the same lookup and we'd
    // waste a duplicate round-trip to the DB.
    const hasCheck21 = checks.includes(21);
    if (account && !hasCheck21 && ['bet', 'win', 'cancel', 'balance', 'authenticate'].includes(command)) {
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
        .where(eq(users.palaceAccount, account))
        .limit(1);
      if (!rows[0]) {
        return {
          checkResult: { result: PALACE_RESULT.CHECK_USER_NOT_FOUND, status: 'ERROR' },
          ctx: null,
        };
      }
      const row = rows[0];
      let wallet: Wallet;
      if (row.walletId) {
        wallet = {
          id: row.walletId,
          userId: row.id,
          balance: row.balance ?? '0.00',
          bonusBalance: row.bonusBalance ?? '0.00',
          currency: row.currency ?? 'CHIPS',
          lockedBalance: row.lockedBalance ?? '0.00',
          version: 0,
          createdAt: new Date(),
          updatedAt: new Date(),
        } as Wallet;
      } else {
        wallet = await this.walletService.getOrCreateWalletForUser(db, row.id);
      }
      ctx = { userId: row.id, userStatus: row.status, wallet };
    }

    // Run explicit checks (if any)
    for (const check of checks) {
      switch (check) {
        case 21: {
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
            .where(eq(users.palaceAccount, account))
            .limit(1);
          if (!rows[0]) {
            return {
              checkResult: {
                result: PALACE_RESULT.CHECK_USER_NOT_FOUND,
                status: 'ERROR',
              },
              ctx: null,
            };
          }
          const row = rows[0];
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
            } as Wallet;
          } else {
            wallet = await this.walletService.getOrCreateWalletForUser(db, row.id);
          }
          ctx = {
            userId: row.id,
            userStatus: row.status,
            wallet,
          };
          break;
        }

        case 22: {
          if (!ctx || ctx.userStatus !== 'active') {
            return {
              checkResult: {
                result: PALACE_RESULT.CHECK_USER_NOT_ACTIVE,
                status: 'ERROR',
              },
              ctx: null,
            };
          }
          break;
        }

        case 31: {
          // Total jugable = (balance − locked) + bonus (LEYES E6): el locked
          // por retiros pendientes no es apostable.
          const balanceCents = toCents(ctx!.wallet.balance);
          const lockedCents = toCents(String(ctx!.wallet.lockedBalance ?? '0'));
          const bonusCents = toCents(String(ctx!.wallet.bonusBalance ?? '0'));
          const totalCents = Math.max(0, balanceCents - lockedCents) + bonusCents;
          const amountCents = toCents(String(data.amount ?? '0'));
          if (totalCents < amountCents) {
            return {
              checkResult: {
                result: PALACE_RESULT.CHECK_INSUFFICIENT_BALANCE,
                status: 'ERROR',
                data: { balance: Number(this.totalBalance(ctx!.wallet)) },
              },
              ctx: null,
            };
          }
          break;
        }

        case 41: {
          // Idempotencia: ¿ya procesamos este trans_guid?
          const transGuid = data.trans_guid ?? '';
          const existing = await db
            .select({ id: palaceTransactions.id })
            .from(palaceTransactions)
            .where(eq(palaceTransactions.transGuid, transGuid))
            .limit(1);
          if (existing[0]) {
            if (command === 'cancel') {
              return {
                checkResult: {
                  result: PALACE_RESULT.OK,
                  status: 'OK',
                  data: { balance: Number(this.totalBalance(ctx!.wallet)) },
                },
                ctx: null,
              };
            }
            return {
              checkResult: {
                result: PALACE_RESULT.CHECK_ALREADY_PROCESSED,
                status: 'ERROR',
                data: { balance: Number(this.totalBalance(ctx!.wallet)) },
              },
              ctx: null,
            };
          }
          break;
        }

        case 42: {
          const transGuid = data.trans_guid ?? '';
          const existing = await db
            .select({ id: palaceTransactions.id })
            .from(palaceTransactions)
            .where(eq(palaceTransactions.transGuid, transGuid))
            .limit(1);
          if (!existing[0]) {
            return {
              checkResult: {
                result: PALACE_RESULT.CHECK_TX_NOT_FOUND,
                status: 'ERROR',
                data: { balance: ctx ? Number(this.totalBalance(ctx.wallet)) : 0 },
              },
              ctx: null,
            };
          }
          break;
        }

        case 43: {
          const cancelGuid = data.cancel_trans_guid ?? '';
          const existing = await db
            .select({
              id: palaceTransactions.id,
              sort: palaceTransactions.sort,
            })
            .from(palaceTransactions)
            .where(eq(palaceTransactions.transGuid, cancelGuid))
            .limit(1);
          if (!existing[0]) {
            return {
              checkResult: {
                result: PALACE_RESULT.CHECK_CANCEL_TX_NOT_FOUND,
                status: 'ERROR',
                data: { balance: ctx ? Number(ctx.wallet.balance) : 0 },
              },
              ctx: null,
            };
          }
          break;
        }
      }
    }

    return { checkResult: null, ctx };
  }

  // ──────────────────────────────────────────────────────────────────
  // Commands — ahora reciben ctx para evitar queries duplicadas
  // ──────────────────────────────────────────────────────────────────

  private async handleBet(
    db: TenantDb,
    data: PalaceCallbackData,
    ctx: ResolvedContext,
  ): Promise<PalaceCallbackResponse> {
    const amountStr = normalizeAmount(data.amount);
    const amountCents = toCents(amountStr);

    // Skip wallet transaction if amount is 0 (test bets from provider)
    let walletTxId: string | null = null;
    if (amountCents > 0) {
      const walletTx = await this.walletService.placeBetWithBonus(db, {
        walletId: ctx.wallet.id,
        amount: amountStr,
        transGuid: data.trans_guid!,
        account: data.account!,
      });
      walletTxId = walletTx.id;
    }

    // Registrar en palace_transactions
    await db.insert(palaceTransactions).values({
      transGuid: data.trans_guid!,
      userId: ctx.userId,
      account: data.account!,
      gameCode: data.game_code ?? undefined,
      gameType: data.game_type ?? undefined,
      roundId: data.round_id ?? undefined,
      sort: 'BET',
      amount: amountStr,
      status: 'OK',
      providerId: data.provider_id ?? undefined,
      type: data.type ?? undefined,
      userCode: data.user_code ?? undefined,
      requestTimestamp: data.time_stamp
        ? new Date(Number(data.time_stamp))
        : null,
    });

    // Sync to game_rounds for stats reporting (non-critical)
    try {
      await this.syncGameRound(db, data, ctx, 'bet', walletTxId);
    } catch (err) {
      this.logger.error(`Failed to sync game round for bet: ${(err as Error).message}`);
    }

    // Re-read wallet to get accurate balance after bet
    const updatedWallet = await this.walletService.getOrCreateWalletForUser(db, ctx.userId);
    return this.ok(this.totalBalance(updatedWallet));
  }

  private async handleWin(
    db: TenantDb,
    data: PalaceCallbackData,
    ctx: ResolvedContext,
  ): Promise<PalaceCallbackResponse> {
    const amountStr = normalizeAmount(data.amount);

    // Tope de sanidad (auditoría económica): un `win` por encima del máximo
    // configurado casi seguro es un callback comprometido → NO se mintea, se
    // alerta al admin. Los premios reales quedan por debajo del tope.
    const winCap = await this.settings.getNumeric(
      db,
      'game_provider.palace.win_max_amount',
      PalaceCallbackService.DEFAULT_WIN_MAX,
    );
    if (winCap > 0 && Number(amountStr) > winCap) {
      this.logger.error(
        `WIN RECHAZADO por tope de sanidad: amount=${amountStr} > cap=${winCap} ` +
          `account=${data.account} guid=${data.trans_guid}`,
      );
      // Alerta al admin (fail-soft — no bloquea la respuesta al proveedor).
      try {
        await this.notifications.enqueueForRole(db, {
          roleCode: 'admin_tenant',
          kind: 'game_provider_alert',
          channel: 'in_app',
          payload: {
            title: 'Win rechazado por tope de sanidad',
            message: `Se rechazó un premio de ${amountStr} (tope ${winCap}) para la cuenta ${data.account ?? '?'}. Revisá si es legítimo o un callback comprometido.`,
          },
        });
      } catch (err) {
        this.logger.error(
          `No se pudo notificar win-over-cap: ${(err as Error).message}`,
        );
      }
      return { result: PALACE_RESULT.INTERNAL_ERROR, status: 'ERROR' };
    }

    let walletTxId: string | null = null;
    if (toCents(amountStr) > 0) {
      const walletTx = await this.walletService.settleWinExternal(db, {
        walletId: ctx.wallet.id,
        amount: amountStr,
        transGuid: data.trans_guid!,
        account: data.account!,
      });
      walletTxId = walletTx.id;
    }

    await db.insert(palaceTransactions).values({
      transGuid: data.trans_guid!,
      userId: ctx.userId,
      account: data.account!,
      gameCode: data.game_code ?? undefined,
      gameType: data.game_type ?? undefined,
      roundId: data.round_id ?? undefined,
      sort: 'WIN',
      amount: amountStr,
      status: 'OK',
      providerId: data.provider_id ?? undefined,
      type: data.type ?? undefined,
      userCode: data.user_code ?? undefined,
      requestTimestamp: data.time_stamp
        ? new Date(Number(data.time_stamp))
        : null,
    });

    // Sync to game_rounds for stats reporting (non-critical)
    try {
      await this.syncGameRound(db, data, ctx, 'win', walletTxId);
    } catch (err) {
      this.logger.error(`Failed to sync game round for win: ${(err as Error).message}`);
    }

    const balanceAfter = this.computeNewBalance(this.totalBalance(ctx.wallet), amountStr, 'credit');
    return this.ok(balanceAfter);
  }

  private async handleCancel(
    db: TenantDb,
    data: PalaceCallbackData,
    ctx: ResolvedContext,
  ): Promise<PalaceCallbackResponse> {
    const cancelGuid = data.cancel_trans_guid!;

    const original = await db
      .select()
      .from(palaceTransactions)
      .where(eq(palaceTransactions.transGuid, cancelGuid))
      .limit(1);

    const originalTx = original[0];
    if (!originalTx) {
      return {
        result: PALACE_RESULT.CHECK_CANCEL_TX_NOT_FOUND,
        status: 'ERROR',
      };
    }

    if (originalTx.status === 'CANCELED') {
      return this.ok(this.totalBalance(ctx.wallet));
    }

    let walletTxId: string | null = null;
    if (originalTx.sort === 'BET') {
      const walletTx = await this.walletService.cancelExternal(db, {
        walletId: ctx.wallet.id,
        amount: originalTx.amount,
        transGuid: data.trans_guid!,
        cancelTransGuid: cancelGuid,
        direction: 'credit',
        account: data.account!,
      });
      walletTxId = walletTx.id;
    } else if (originalTx.sort === 'WIN') {
      const amountCents = toCents(originalTx.amount);
      if (amountCents > 0) {
        const walletTx = await this.walletService.cancelExternal(db, {
          walletId: ctx.wallet.id,
          amount: originalTx.amount,
          transGuid: data.trans_guid!,
          cancelTransGuid: cancelGuid,
          direction: 'debit',
          account: data.account!,
        });
        walletTxId = walletTx.id;
      }
    }

    await db
      .update(palaceTransactions)
      .set({ status: 'CANCELED' })
      .where(eq(palaceTransactions.id, originalTx.id));

    await db.insert(palaceTransactions).values({
      transGuid: data.trans_guid!,
      userId: ctx.userId,
      account: data.account!,
      gameCode: originalTx.gameCode,
      gameType: originalTx.gameType,
      roundId: originalTx.roundId,
      sort: 'CANCEL',
      amount: originalTx.amount,
      status: 'OK',
      providerId: originalTx.providerId,
      type: data.type ?? undefined,
      userCode: originalTx.userCode,
      requestTimestamp: data.time_stamp
        ? new Date(Number(data.time_stamp))
        : null,
    });

    // Sync to game_rounds for stats reporting (non-critical)
    try {
      await this.syncGameRound(db, data, ctx, 'cancel', walletTxId, originalTx.roundId);
    } catch (err) {
      this.logger.error(`Failed to sync game round for cancel: ${(err as Error).message}`);
    }

    // Compute balance from wallet instead of re-querying
    const direction = originalTx.sort === 'BET' ? 'credit' : 'debit';
    const balanceAfter = this.computeNewBalance(this.totalBalance(ctx.wallet), originalTx.amount, direction);
    return this.ok(balanceAfter);
  }

  private async handleStatus(
    db: TenantDb,
    data: PalaceCallbackData,
    _ctx: ResolvedContext,
  ): Promise<PalaceCallbackResponse> {
    const transGuid = data.trans_guid ?? '';
    const rows = await db
      .select()
      .from(palaceTransactions)
      .where(eq(palaceTransactions.transGuid, transGuid))
      .limit(1);
    const tx = rows[0];
    if (!tx) {
      return {
        result: PALACE_RESULT.CHECK_TX_NOT_FOUND,
        status: 'ERROR',
      };
    }
    const transStatus = tx.status === 'CANCELED' ? 'CANCELED' : 'OK';
    return {
      result: PALACE_RESULT.OK,
      status: 'OK',
      data: {
        account: tx.account,
        trans_guid: transGuid,
        trans_status: transStatus,
      },
    };
  }

  // ──────────────────────────────────────────────────────────────────
  // Game rounds sync — bridges Palace callbacks → game_rounds table
  // so that game stats reporting works for Palace external bets.
  // ──────────────────────────────────────────────────────────────────

  private async syncGameRound(
    db: TenantDb,
    data: PalaceCallbackData,
    ctx: ResolvedContext,
    command: 'bet' | 'win' | 'cancel',
    walletTxId: string | null,
    originalRoundId?: string | null,
  ) {
    if (!data.game_code) return;

    // 1. Look up game by palaceGameSymbol
    const [game] = await db
      .select({ id: games.id })
      .from(games)
      .where(eq(games.palaceGameSymbol, data.game_code))
      .limit(1);
    if (!game) return;

    // 2. Find or create virtual session for this user+game
    const sessionKey = `palace:${data.account}:${data.game_code}`;
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

    // 3. Determine round_external_id
    const roundExternalId =
      command === 'cancel'
        ? (originalRoundId ?? data.cancel_trans_guid ?? '')
        : (data.round_id ?? data.trans_guid ?? '');
    if (!roundExternalId) return;

    // 4. Upsert game_round
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
          betAmount: normalizeAmount(data.amount),
          winAmount: '0.00',
          netAmount: '0.00',
          status: 'placed',
          betWalletTxId: walletTxId,
          payload: data as Record<string, unknown>,
          placedAt: data.time_stamp
            ? new Date(Number(data.time_stamp))
            : new Date(),
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

      const winAmount = normalizeAmount(data.amount);
      if (existing) {
        const netAmount = (
          Number(winAmount) - Number(existing.betAmount)
        ).toFixed(2);
        await db
          .update(gameRounds)
          .set({
            winAmount,
            netAmount,
            status: 'settled',
            winWalletTxId: walletTxId,
            settledAt: new Date(),
          })
          .where(eq(gameRounds.id, existing.id));
      } else {
        // Win without prior bet — create settled round directly
        await db.insert(gameRounds).values({
          sessionId: session.id,
          userId: ctx.userId,
          gameId: game.id,
          roundExternalId,
          betAmount: '0.00',
          winAmount,
          netAmount: winAmount,
          status: 'settled',
          winWalletTxId: walletTxId,
          payload: data as Record<string, unknown>,
          placedAt: data.time_stamp
            ? new Date(Number(data.time_stamp))
            : new Date(),
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

  // ──────────────────────────────────────────────────────────────────
  // Helpers
  // ──────────────────────────────────────────────────────────────────

  /** Helper para crear response OK con balance. */
  private ok(balance: string | number): PalaceCallbackResponse {
    return {
      result: PALACE_RESULT.OK,
      status: 'OK',
      data: { balance: Number(balance) },
    };
  }

  /**
   * Total jugable = (balance real − locked) + bonus_balance.
   * El `locked_balance` (retiros pendientes en hold, LEYES E6) NO es
   * apostable, así que no se reporta al proveedor: el jugador no debe ver
   * en el juego un saldo que no puede usar.
   */
  private totalBalance(wallet: Pick<Wallet, 'balance' | 'bonusBalance' | 'lockedBalance'>): string {
    const cents = Math.max(
      0,
      toCents(wallet.balance) +
        toCents(String(wallet.bonusBalance ?? '0')) -
        toCents(String(wallet.lockedBalance ?? '0')),
    );
    return (cents / 100).toFixed(2);
  }

  /** Compute balance after a bet/win without re-querying wallet. */
  private computeNewBalance(
    currentBalance: string,
    amount: string,
    direction: 'debit' | 'credit',
  ): string {
    const current = Number(currentBalance);
    const amt = Number(amount);
    if (direction === 'debit') {
      return (current - amt).toFixed(2);
    }
    return (current + amt).toFixed(2);
  }
}

// ──────────────────────────────────────────────────────────────────────
// Helpers de conversión de montos
// ──────────────────────────────────────────────────────────────────────

/**
 * Convierte un monto string/number (ej. "10.50" o 10.5) a centavos (int).
 * ARS con centavos: NO truncar.
 */
function toCents(value: string | number): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100);
}

/**
 * Normaliza un monto a string numeric(20,2). Ej: 0.9 → "0.90".
 */
function normalizeAmount(value: string | number | undefined): string {
  const n = typeof value === 'number' ? value : Number(value ?? '0');
  if (!Number.isFinite(n)) return '0.00';
  return n.toFixed(2);
}

