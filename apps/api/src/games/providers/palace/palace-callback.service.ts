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
import { eq } from 'drizzle-orm';
import {
  palaceTransactions,
  users,
  type Wallet,
} from '@casino/db';
import type { TenantDb } from '../../../tenant-resolver/tenant-context';
import { WalletService } from '../../../wallet/wallet.service';
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

  constructor(private readonly walletService: WalletService) {}

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
          return this.ok(ctx.wallet.balance);

        case 'balance':
          return this.ok(ctx.wallet.balance);

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

      // Error inesperado → log + 99
      this.logger.error(`Error procesando command '${command}': ${(err as Error).message}`);
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

    // Resolve user + wallet up-front for account-based commands
    if (account && ['bet', 'win', 'cancel', 'balance', 'authenticate'].includes(command)) {
      const rows = await db
        .select({ id: users.id, status: users.status })
        .from(users)
        .where(eq(users.palaceAccount, account))
        .limit(1);
      if (!rows[0]) {
        return {
          checkResult: { result: PALACE_RESULT.CHECK_USER_NOT_FOUND, status: 'ERROR' },
          ctx: null,
        };
      }
      const wallet = await this.walletService.getOrCreateWalletForUser(db, rows[0].id);
      ctx = { userId: rows[0].id, userStatus: rows[0].status, wallet };
    }

    // Run explicit checks (if any)
    for (const check of checks) {
      switch (check) {
        case 21: {
          const rows = await db
            .select({
              id: users.id,
              status: users.status,
            })
            .from(users)
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
          // Cargar wallet UNA vez (reutilizado por todos los handlers)
          const wallet = await this.walletService.getOrCreateWalletForUser(db, rows[0].id);
          ctx = {
            userId: rows[0].id,
            userStatus: rows[0].status,
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
          const balanceCents = toCents(ctx!.wallet.balance);
          const bonusCents = toCents(String(ctx!.wallet.bonusBalance ?? '0'));
          const totalCents = balanceCents + bonusCents;
          const amountCents = toCents(String(data.amount ?? '0'));
          if (totalCents < amountCents) {
            return {
              checkResult: {
                result: PALACE_RESULT.CHECK_INSUFFICIENT_BALANCE,
                status: 'ERROR',
                data: { balance: Number(ctx!.wallet.balance) },
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
                  data: { balance: Number(ctx!.wallet.balance) },
                },
                ctx: null,
              };
            }
            return {
              checkResult: {
                result: PALACE_RESULT.CHECK_ALREADY_PROCESSED,
                status: 'ERROR',
                data: { balance: Number(ctx!.wallet.balance) },
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
                data: { balance: ctx ? Number(ctx.wallet.balance) : 0 },
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
    if (amountCents > 0) {
      await this.walletService.placeBetWithBonus(db, {
        walletId: ctx.wallet.id,
        amount: amountStr,
        transGuid: data.trans_guid!,
        account: data.account!,
      });
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

    // Re-read wallet to get accurate balance after bet
    const updatedWallet = await this.walletService.getOrCreateWalletForUser(db, ctx.userId);
    return this.ok(updatedWallet.balance);
  }

  private async handleWin(
    db: TenantDb,
    data: PalaceCallbackData,
    ctx: ResolvedContext,
  ): Promise<PalaceCallbackResponse> {
    const amountStr = normalizeAmount(data.amount);

    if (toCents(amountStr) > 0) {
      await this.walletService.settleWinExternal(db, {
        walletId: ctx.wallet.id,
        amount: amountStr,
        transGuid: data.trans_guid!,
        account: data.account!,
      });
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

    const balanceAfter = this.computeNewBalance(ctx.wallet.balance, amountStr, 'credit');
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
      return this.ok(ctx.wallet.balance);
    }

    if (originalTx.sort === 'BET') {
      await this.walletService.cancelExternal(db, {
        walletId: ctx.wallet.id,
        amount: originalTx.amount,
        transGuid: data.trans_guid!,
        cancelTransGuid: cancelGuid,
        direction: 'credit',
        account: data.account!,
      });
    } else if (originalTx.sort === 'WIN') {
      const amountCents = toCents(originalTx.amount);
      if (amountCents > 0) {
        await this.walletService.cancelExternal(db, {
          walletId: ctx.wallet.id,
          amount: originalTx.amount,
          transGuid: data.trans_guid!,
          cancelTransGuid: cancelGuid,
          direction: 'debit',
          account: data.account!,
        });
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

    // Compute balance from wallet instead of re-querying
    const direction = originalTx.sort === 'BET' ? 'credit' : 'debit';
    const balanceAfter = this.computeNewBalance(ctx.wallet.balance, originalTx.amount, direction);
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

