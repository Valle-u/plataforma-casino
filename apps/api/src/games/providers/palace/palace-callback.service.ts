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
 */

import { Injectable, Logger } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import {
  palaceTransactions,
  users,
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

      const checkResult = await this.runChecks(db, command, data, checks);
      if (checkResult) {
        return checkResult;
      }

      // ── Procesar command ──

      switch (command) {
        case 'authenticate':
          return await this.handleAuthenticate(db, data);

        case 'balance':
          return await this.handleBalance(db, data);

        case 'bet':
          return await this.handleBet(db, data);

        case 'win':
          return await this.handleWin(db, data);

        case 'cancel':
          return await this.handleCancel(db, data);

        case 'status':
          return await this.handleStatus(db, data);

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
      this.logger.error(
        `Error procesando command '${command}': ${(err as Error).message}`,
        (err as Error).stack,
      );
      return {
        result: PALACE_RESULT.INTERNAL_ERROR,
        status: 'ERROR',
      };
    }
  }

  // ──────────────────────────────────────────────────────────────────
  // Checks
  // ──────────────────────────────────────────────────────────────────

  private async runChecks(
    db: TenantDb,
    command: PalaceCommand,
    data: PalaceCallbackData,
    checks: number[],
  ): Promise<PalaceCallbackResponse | null> {
    const account = data.account ?? '';

    // Check 21: el usuario existe
    let userInfo: { id: string; status: string; balance: string } | null = null;

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
              result: PALACE_RESULT.CHECK_USER_NOT_FOUND,
              status: 'ERROR',
            };
          }
          userInfo = {
            id: rows[0].id,
            status: rows[0].status,
            balance: '0',
          };
          break;
        }

        case 22: {
          if (!userInfo || userInfo.status !== 'active') {
            return {
              result: PALACE_RESULT.CHECK_USER_NOT_ACTIVE,
              status: 'ERROR',
            };
          }
          break;
        }

        case 31: {
          const user = userInfo!;
          const wallet =
            await this.walletService.getOrCreateWalletForUser(db, user.id);
          const balanceCents = toCents(wallet.balance);
          const amountCents = toCents(String(data.amount ?? '0'));
          if (balanceCents < amountCents) {
            return {
              result: PALACE_RESULT.CHECK_INSUFFICIENT_BALANCE,
              status: 'ERROR',
              data: { balance: Number(wallet.balance) },
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
            const user = userInfo!;
            const wallet =
              await this.walletService.getOrCreateWalletForUser(db, user.id);
            // Para cancel: idempotente → devolver OK (ya se procesó, todo bien).
            // Para bet/win: devolver 41 (ya procesado, error).
            if (command === 'cancel') {
              return {
                result: PALACE_RESULT.OK,
                status: 'OK',
                data: { balance: Number(wallet.balance) },
              };
            }
            return {
              result: PALACE_RESULT.CHECK_ALREADY_PROCESSED,
              status: 'ERROR',
              data: { balance: Number(wallet.balance) },
            };
          }
          break;
        }

        case 42: {
          // El trans_guid debe existir (para status)
          const transGuid = data.trans_guid ?? '';
          const existing = await db
            .select({ id: palaceTransactions.id })
            .from(palaceTransactions)
            .where(eq(palaceTransactions.transGuid, transGuid))
            .limit(1);
          if (!existing[0]) {
            const balance = userInfo
              ? await this.getUserBalance(db, userInfo.id)
              : '0';
            return {
              result: PALACE_RESULT.CHECK_TX_NOT_FOUND,
              status: 'ERROR',
              data: { balance: Number(balance) },
            };
          }
          break;
        }

        case 43: {
          // El cancel_trans_guid debe existir (para cancel)
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
            const balance = userInfo
              ? data.account
                ? await this.getAccountBalance(db, data.account)
                : '0'
              : '0';
            return {
              result: PALACE_RESULT.CHECK_CANCEL_TX_NOT_FOUND,
              status: 'ERROR',
              data: { balance: Number(balance) },
            };
          }
          break;
        }
      }
    }

    return null; // Todos los checks pasaron
  }

  // ──────────────────────────────────────────────────────────────────
  // Commands
  // ──────────────────────────────────────────────────────────────────

  private async handleAuthenticate(
    db: TenantDb,
    data: PalaceCallbackData,
  ): Promise<PalaceCallbackResponse> {
    const user = await this.getUserByAccount(db, data.account!);
    const wallet = await this.walletService.getOrCreateWalletForUser(db, user.id);
    return {
      result: PALACE_RESULT.OK,
      status: 'OK',
      data: {
        account: data.account,
        balance: Number(wallet.balance),
      },
    };
  }

  private async handleBalance(
    db: TenantDb,
    data: PalaceCallbackData,
  ): Promise<PalaceCallbackResponse> {
    const user = await this.getUserByAccount(db, data.account!);
    const wallet = await this.walletService.getOrCreateWalletForUser(db, user.id);
    return {
      result: PALACE_RESULT.OK,
      status: 'OK',
      data: { balance: Number(wallet.balance) },
    };
  }

  private async handleBet(
    db: TenantDb,
    data: PalaceCallbackData,
  ): Promise<PalaceCallbackResponse> {
    const user = await this.getUserByAccount(db, data.account!);
    const wallet = await this.walletService.getOrCreateWalletForUser(db, user.id);
    const amountStr = normalizeAmount(data.amount);

    // Debitar wallet (burn puro)
    await this.walletService.placeBetExternal(db, {
      walletId: wallet.id,
      amount: amountStr,
      transGuid: data.trans_guid!,
      account: data.account!,
    });

    // Registrar en palace_transactions
    await db.insert(palaceTransactions).values({
      transGuid: data.trans_guid!,
      userId: user.id,
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

    const updatedWallet = await this.walletService.getByUserId(db, user.id);
    return {
      result: PALACE_RESULT.OK,
      status: 'OK',
      data: { balance: Number(updatedWallet.balance) },
    };
  }

  private async handleWin(
    db: TenantDb,
    data: PalaceCallbackData,
  ): Promise<PalaceCallbackResponse> {
    const user = await this.getUserByAccount(db, data.account!);
    const wallet = await this.walletService.getOrCreateWalletForUser(db, user.id);
    const amountStr = normalizeAmount(data.amount);

    // Si amount > 0 → acreditar wallet (mint puro)
    if (toCents(amountStr) > 0) {
      await this.walletService.settleWinExternal(db, {
        walletId: wallet.id,
        amount: amountStr,
        transGuid: data.trans_guid!,
        account: data.account!,
      });
    }

    // Registrar en palace_transactions (incluso si amount=0, que es una loss)
    await db.insert(palaceTransactions).values({
      transGuid: data.trans_guid!,
      userId: user.id,
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

    const updatedWallet = await this.walletService.getByUserId(db, user.id);
    return {
      result: PALACE_RESULT.OK,
      status: 'OK',
      data: { balance: Number(updatedWallet.balance) },
    };
  }

  private async handleCancel(
    db: TenantDb,
    data: PalaceCallbackData,
  ): Promise<PalaceCallbackResponse> {
    const user = await this.getUserByAccount(db, data.account!);
    const cancelGuid = data.cancel_trans_guid!;

    // Buscar la transacción original
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

    // Si ya está cancelada, no hacer nada (idempotente)
    if (originalTx.status === 'CANCELED') {
      const wallet = await this.walletService.getByUserId(db, user.id);
      return {
        result: PALACE_RESULT.OK,
        status: 'OK',
        data: { balance: Number(wallet.balance) },
      };
    }

    const wallet = await this.walletService.getByUserId(db, user.id);

    // Reversar: si era BET → devolver (credit). Si era WIN → restar (debit).
    if (originalTx.sort === 'BET') {
      await this.walletService.cancelExternal(db, {
        walletId: wallet.id,
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
          walletId: wallet.id,
          amount: originalTx.amount,
          transGuid: data.trans_guid!,
          cancelTransGuid: cancelGuid,
          direction: 'debit',
          account: data.account!,
        });
      }
    }

    // Marcar la original como CANCELED
    await db
      .update(palaceTransactions)
      .set({ status: 'CANCELED' })
      .where(eq(palaceTransactions.id, originalTx.id));

    // Registrar la transacción de cancel
    await db.insert(palaceTransactions).values({
      transGuid: data.trans_guid!,
      userId: user.id,
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

    const updatedWallet = await this.walletService.getByUserId(db, user.id);
    return {
      result: PALACE_RESULT.OK,
      status: 'OK',
      data: { balance: Number(updatedWallet.balance) },
    };
  }

  private async handleStatus(
    db: TenantDb,
    data: PalaceCallbackData,
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

  private async getUserByAccount(
    db: TenantDb,
    account: string,
  ): Promise<{ id: string; status: string }> {
    const rows = await db
      .select({ id: users.id, status: users.status })
      .from(users)
      .where(eq(users.palaceAccount, account))
      .limit(1);
    if (!rows[0]) throw new PalaceUserNotFoundError(account);
    return rows[0];
  }

  private async getUserBalance(
    db: TenantDb,
    userId: string,
  ): Promise<string> {
    const wallet =
      await this.walletService.getOrCreateWalletForUser(db, userId);
    return wallet.balance;
  }

  private async getAccountBalance(
    db: TenantDb,
    account: string,
  ): Promise<string> {
    const user = await this.getUserByAccount(db, account);
    return this.getUserBalance(db, user.id);
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

