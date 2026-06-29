/**
 * HouseService — la cuenta "Casa" / tesorería del tenant + aportes de capital.
 *
 * Blindaje del núcleo económico, Parte B (ver docs/16-tesoreria.md). La Casa es
 * un usuario de SISTEMA (`is_system`, username `__casa__`) con su wallet: la
 * única fuente de fichas y la contraparte de todo.
 *
 * B-build-1: resolución + estado. B-build-3: aporte de capital (la ÚNICA forma
 * de crear fichas) atado a una transferencia bancaria entrante — mintea a la
 * Casa de forma atómica (mint + match del bank_tx + registro del aporte).
 */

import { Injectable } from '@nestjs/common';
import { desc, eq, sql } from 'drizzle-orm';
import {
  HOUSE_USERNAME,
  bankTransactions,
  generateUuidV7,
  houseCapitalInjections,
  users,
  wallets,
  type HouseCapitalInjection,
  type User,
  type Wallet,
} from '@casino/db';
import type { TenantDb } from '../tenant-resolver/tenant-context';
import { WalletService } from '../wallet/wallet.service';
import {
  HouseBankTxAlreadyMatchedError,
  HouseBankTxNotFoundError,
  HouseBankTxNotIncomingError,
} from './house.errors';

/** La Casa no está provisionada en este tenant (seed viejo / falta migrar). */
export class HouseNotProvisionedError extends Error {
  constructor() {
    super('La cuenta Casa / tesorería no está provisionada en este tenant.');
    this.name = 'HouseNotProvisionedError';
  }
}

export interface HouseState {
  userId: string;
  username: string;
  displayName: string;
  /** Fichas disponibles de la Casa. */
  balance: string;
  /** Fichas bloqueadas de la Casa (holds). */
  lockedBalance: string;
}

@Injectable()
export class HouseService {
  constructor(private readonly walletService: WalletService) {}

  /** El usuario de la Casa. Null si el tenant no lo tiene provisionado. */
  async getHouseUser(db: TenantDb): Promise<User | null> {
    const rows = await db
      .select()
      .from(users)
      .where(eq(users.username, HOUSE_USERNAME))
      .limit(1);
    return rows[0] ?? null;
  }

  /** La wallet de la Casa. Tira `HouseNotProvisionedError` si no existe. */
  async getHouseWallet(db: TenantDb): Promise<Wallet> {
    const user = await this.getHouseUser(db);
    if (!user) throw new HouseNotProvisionedError();
    const rows = await db
      .select()
      .from(wallets)
      .where(eq(wallets.userId, user.id))
      .limit(1);
    const wallet = rows[0];
    if (!wallet) throw new HouseNotProvisionedError();
    return wallet;
  }

  /** Estado de la Casa para el panel de tesorería. */
  async getHouseState(db: TenantDb): Promise<HouseState> {
    const user = await this.getHouseUser(db);
    if (!user) throw new HouseNotProvisionedError();
    const wallet = await this.getHouseWallet(db);
    return {
      userId: user.id,
      username: user.username,
      displayName: user.displayName,
      balance: wallet.balance,
      lockedBalance: wallet.lockedBalance,
    };
  }

  /**
   * Aporte de capital del dueño a la Casa (B-build-3). La ÚNICA forma de crear
   * fichas nuevas: atado a una transferencia bancaria ENTRANTE (la plata real
   * del dueño). Mintea el monto del bank_tx a la wallet de la Casa.
   *
   * Atómico: lockea el bank_tx (FOR UPDATE), valida que sea incoming y
   * unmatched, mintea a la Casa, registra el aporte y matchea el bank_tx — todo
   * en una `db.transaction`. El monto se toma del bank_tx (1 ficha = 1 peso).
   */
  async injectCapital(
    db: TenantDb,
    params: {
      bankTransactionId: string;
      actorUserId: string;
      notes?: string | null;
    },
  ): Promise<HouseCapitalInjection> {
    const houseWallet = await this.getHouseWallet(db); // throws si no provisionada

    return db.transaction(async (txRaw) => {
      const tx = txRaw as unknown as TenantDb;

      // 1. Lock + validar el bank_tx.
      const bankRows = await txRaw
        .select()
        .from(bankTransactions)
        .where(eq(bankTransactions.id, params.bankTransactionId))
        .for('update')
        .limit(1);
      const bankTx = bankRows[0];
      if (!bankTx) {
        throw new HouseBankTxNotFoundError(params.bankTransactionId);
      }
      if (bankTx.direction !== 'incoming') {
        throw new HouseBankTxNotIncomingError();
      }
      if (bankTx.status !== 'unmatched') {
        throw new HouseBankTxAlreadyMatchedError();
      }

      // 2. Mintear el monto del bank_tx a la Casa.
      const injectionId = generateUuidV7();
      const mintTx = await this.walletService.mintToWallet(tx, {
        walletId: houseWallet.id,
        amount: bankTx.amount,
        source: 'house_capital',
        referenceId: injectionId,
        idempotencyKey: `house_capital:${params.bankTransactionId}`,
        reason: 'Aporte de capital del dueño a la Casa',
        createdBy: params.actorUserId,
        counterpartyUserId: null,
      });

      // 3. Registrar el aporte.
      const inserted = await txRaw
        .insert(houseCapitalInjections)
        .values({
          id: injectionId,
          amount: bankTx.amount,
          bankTransactionId: params.bankTransactionId,
          mintTxId: mintTx.id,
          createdBy: params.actorUserId,
          notes: params.notes ?? null,
        })
        .returning();

      // 4. Matchear el bank_tx con el aporte.
      await txRaw
        .update(bankTransactions)
        .set({
          status: 'matched',
          matchedCapitalInjectionId: injectionId,
          matchedBy: params.actorUserId,
          matchedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(bankTransactions.id, params.bankTransactionId));

      return inserted[0]!;
    });
  }

  /** Historial de aportes de capital (más nuevos primero). */
  async listInjections(
    db: TenantDb,
    limit = 50,
    offset = 0,
  ): Promise<{ injections: HouseCapitalInjection[]; total: number }> {
    const injections = await db
      .select()
      .from(houseCapitalInjections)
      .orderBy(
        desc(houseCapitalInjections.createdAt),
        desc(houseCapitalInjections.id),
      )
      .limit(Math.min(Math.max(limit, 1), 200))
      .offset(Math.max(offset, 0));
    const totalRows = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(houseCapitalInjections);
    return { injections, total: totalRows[0]?.count ?? 0 };
  }
}
