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
import { UserHierarchyService } from '../user-hierarchy/user-hierarchy.service';
import {
  HouseBankTxAlreadyMatchedError,
  HouseBankTxNotFoundError,
  HouseBankTxNotIncomingError,
  InjectOperatorInvalidError,
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

/**
 * Shape informativo para callers que resuelven "quién es el issuer" (Casa o
 * socio indep dueño de la rama) antes de fondear una operación con un player.
 * `balanceAvailable` es una lectura sin lock — usar sólo para pre-check o
 * mensajes; el debit real debe correr por `executeTransferPair`, que toma
 * FOR UPDATE.
 */
export interface IssuerResolution {
  walletId: string;
  isCasa: boolean;
  operatorUserId: string | null;
  balanceAvailable: string; // decimal string, informativo (executeTransferPair hace el lock real)
}

@Injectable()
export class HouseService {
  constructor(
    private readonly walletService: WalletService,
    private readonly hierarchy: UserHierarchyService,
  ) {}

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
   * Resuelve QUÉ wallet banca el juego de `playerId`:
   *   - Si el jugador cuelga de una sucursal INDEPENDIENTE → la wallet de ese
   *     operador (banca su PROPIO riesgo de juego; compró las fichas a la Casa).
   *   - Si no → la Casa del tenant (comportamiento por defecto).
   *
   * Devuelve la wallet + `operatorUserId` (null = es la Casa) para distinguir
   * el caso en errores/mensajes. Pensado para correr DENTRO de la tx del round.
   */
  async resolveHouseWalletForPlayer(
    db: TenantDb,
    playerId: string,
  ): Promise<{ wallet: Wallet; operatorUserId: string | null }> {
    const operatorId = await this.hierarchy.getNearestIndependentBranchAncestor(
      db,
      playerId,
    );
    if (operatorId) {
      const wallet = await this.walletService.getOrCreateWalletForUser(
        db,
        operatorId,
      );
      return { wallet, operatorUserId: operatorId };
    }
    const casa = await this.getHouseWallet(db);
    return { wallet: casa, operatorUserId: null };
  }

  /**
   * Resuelve QUIÉN debe fondear/recibir la ficha en operaciones que involucran
   * a un player: la wallet del socio indep dueño de la rama si el player cuelga
   * de una sub-red indep, o la wallet de la Casa del tenant si no.
   *
   * Callers deben lockear con FOR UPDATE la wallet resuelta antes de transferir
   * (o dejar que executeTransferPair lo haga). El balance devuelto es informativo.
   */
  async resolveIssuerForPlayer(
    db: TenantDb,
    playerId: string,
  ): Promise<IssuerResolution> {
    const { wallet, operatorUserId } = await this.resolveHouseWalletForPlayer(
      db,
      playerId,
    );
    return {
      walletId: wallet.id,
      isCasa: operatorUserId === null,
      operatorUserId,
      balanceAvailable: wallet.balance,
    };
  }

  /**
   * Aporte de capital del dueño (B-build-3). La ÚNICA forma de crear fichas
   * nuevas: atado a una transferencia bancaria ENTRANTE (la plata real del
   * dueño). Mintea el monto del bank_tx a la wallet destino.
   *
   * F5: si se pasa `operatorUserId` (socio indep con `is_independent_branch=true`),
   * el minteo va al bankroll de ese operador. Si es null/omit → wallet de la Casa
   * (comportamiento pre-F5). Si el operator no existe o no es indep, lanza
   * `InjectOperatorInvalidError`.
   *
   * Atómico: lockea el bank_tx (FOR UPDATE), valida que sea incoming y
   * unmatched, mintea al destino, registra el aporte y matchea el bank_tx —
   * todo en una `db.transaction`. El monto se toma del bank_tx (1 ficha = 1 peso).
   */
  async injectCapital(
    db: TenantDb,
    params: {
      bankTransactionId: string;
      actorUserId: string;
      notes?: string | null;
      operatorUserId?: string | null;
    },
  ): Promise<HouseCapitalInjection> {
    const operatorUserId = params.operatorUserId ?? null;

    // Resolvemos la wallet destino ANTES de la tx principal. Si es la Casa,
    // getHouseWallet ya tira `HouseNotProvisionedError` si no está provisionada.
    // Si es un operador indep, validamos que exista + is_independent_branch=true.
    let destWalletId: string;
    if (operatorUserId === null) {
      const houseWallet = await this.getHouseWallet(db);
      destWalletId = houseWallet.id;
    } else {
      await this.assertOperatorIsIndep(db, operatorUserId);
      const operatorWallet = await this.walletService.getOrCreateWalletForUser(
        db,
        operatorUserId,
      );
      destWalletId = operatorWallet.id;
    }

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

      // 2. Mintear el monto del bank_tx a la wallet destino (Casa o indep).
      const injectionId = generateUuidV7();
      const mintTx = await this.walletService.mintToWallet(tx, {
        walletId: destWalletId,
        amount: bankTx.amount,
        source: 'house_capital',
        referenceId: injectionId,
        idempotencyKey: `house_capital:${params.bankTransactionId}`,
        reason: operatorUserId
          ? `Aporte de capital a socio indep ${operatorUserId}`
          : 'Aporte de capital del dueño a la Casa',
        createdBy: params.actorUserId,
        counterpartyUserId: null,
      });

      // 3. Registrar el aporte (type='capital', respaldado por bank_tx).
      const inserted = await txRaw
        .insert(houseCapitalInjections)
        .values({
          id: injectionId,
          type: 'capital',
          amount: bankTx.amount,
          reason: 'aporte_capital',
          bankTransactionId: params.bankTransactionId,
          mintTxId: mintTx.id,
          createdBy: params.actorUserId,
          operatorUserId,
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

  /**
   * Fondeo de PRESUPUESTO a la Casa (docs/16 §12, modelo "banco central").
   *
   * A diferencia de `injectCapital` (atado a un bank_tx), acá el admin fija el
   * monto y el motivo directo. Es más flexible pero exige `reason` para dejar
   * traza clara en el audit. El propósito es limitar las fichas "ilimitadas"
   * del proveedor de juego a un techo que el dueño controla.
   *
   * D5: `idempotencyKey` es OBLIGATORIA. Sin key, un retry del cliente
   * (timeout de red, doble click, back-off) generaba `injectionId` nuevo por
   * request → key distinta → mint doble a la wallet destino (fuga de fichas).
   *
   * Atómico: mintea + registra el fondeo en una sola tx. Doblemente blindado:
   *   - `mintToWallet` chequea el UNIQUE de `wallet_transactions.idempotency_key`;
   *     si la key ya fue usada, devuelve la tx existente sin re-mintear.
   *   - Antes del INSERT en `house_capital_injections` releemos por `mint_tx_id`
   *     y si ya hay una fila con ese mintTx la devolvemos (evita doble fila
   *     apuntando al mismo mint en caso de reintento).
   */
  async injectBudget(
    db: TenantDb,
    params: {
      amount: string;
      reason: string;
      actorUserId: string;
      notes?: string | null;
      idempotencyKey: string;
      operatorUserId?: string | null;
    },
  ): Promise<HouseCapitalInjection> {
    const operatorUserId = params.operatorUserId ?? null;

    // Resolver la wallet destino (Casa o indep) antes de la tx.
    let destWalletId: string;
    if (operatorUserId === null) {
      const houseWallet = await this.getHouseWallet(db);
      destWalletId = houseWallet.id;
    } else {
      await this.assertOperatorIsIndep(db, operatorUserId);
      const operatorWallet = await this.walletService.getOrCreateWalletForUser(
        db,
        operatorUserId,
      );
      destWalletId = operatorWallet.id;
    }

    return db.transaction(async (txRaw) => {
      const tx = txRaw as unknown as TenantDb;

      const injectionId = generateUuidV7();

      // 1. Mintear el presupuesto a la wallet destino (Casa o indep).
      //    Si la idempotencyKey ya existía, mintToWallet devuelve la tx previa
      //    sin re-mintear (ver executeTransaction §11).
      const mintTx = await this.walletService.mintToWallet(tx, {
        walletId: destWalletId,
        amount: params.amount,
        source: 'house_budget',
        referenceId: injectionId,
        idempotencyKey: params.idempotencyKey,
        reason: operatorUserId
          ? `Presupuesto a socio indep ${operatorUserId}: ${params.reason}`
          : `Presupuesto a la Casa: ${params.reason}`,
        createdBy: params.actorUserId,
        counterpartyUserId: null,
      });

      // 2. Idempotency blindaje de la fila injection: si ya existe una fila
      //    apuntando a este mintTx, es un retry — devolvemos la existente en
      //    vez de insertar duplicado (no hay UNIQUE en mint_tx_id).
      const existing = await txRaw
        .select()
        .from(houseCapitalInjections)
        .where(eq(houseCapitalInjections.mintTxId, mintTx.id))
        .limit(1);
      if (existing[0]) return existing[0];

      // 3. Registrar el fondeo.
      const inserted = await txRaw
        .insert(houseCapitalInjections)
        .values({
          id: injectionId,
          type: 'budget',
          amount: params.amount,
          reason: params.reason,
          bankTransactionId: null,
          mintTxId: mintTx.id,
          createdBy: params.actorUserId,
          operatorUserId,
          notes: params.notes ?? null,
        })
        .returning();

      return inserted[0]!;
    });
  }

  /**
   * F5: valida que `operatorUserId` exista y tenga `is_independent_branch=true`.
   * Tira `InjectOperatorInvalidError` si no. Usado por injectCapital/injectBudget
   * cuando se targetea a un socio indep en vez de la Casa.
   */
  private async assertOperatorIsIndep(
    db: TenantDb,
    operatorUserId: string,
  ): Promise<void> {
    const rows = await db
      .select({
        id: users.id,
        isIndep: users.isIndependentBranch,
      })
      .from(users)
      .where(eq(users.id, operatorUserId))
      .limit(1);
    const row = rows[0];
    if (!row) {
      throw new InjectOperatorInvalidError(operatorUserId, 'not_found');
    }
    if (!row.isIndep) {
      throw new InjectOperatorInvalidError(operatorUserId, 'not_indep');
    }
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
