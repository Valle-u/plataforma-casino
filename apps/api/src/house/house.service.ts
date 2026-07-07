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
import { and, desc, eq, gte, sql } from 'drizzle-orm';
import {
  HOUSE_USERNAME,
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
import { TenantSettingsService } from '../tenant-settings/tenant-settings.service';
import { UserHierarchyService } from '../user-hierarchy/user-hierarchy.service';
import { IdempotencyConflictError } from '../wallet/wallet.errors';
import { InjectOperatorInvalidError } from './house.errors';

/**
 * D5+N3: prefijo interno para la idempotency key del cliente en `injectBudget`.
 * La key cruda del cliente podría colisionar con keys de otros flujos
 * (deposit:, withdrawal:, bonus_grant:) — un cliente accidental (o hostil)
 * que mande una key ya usada por otro flow recibiría la tx previa como si el
 * mint hubiera ocurrido cuando no. Namespaceándola acá adentro cortamos el
 * canal: la key libre del cliente sigue siendo lo que él ve/reintenta, pero
 * en `wallet_transactions` guardamos `house_budget:<clientKey>`.
 */
const BUDGET_IDEMPOTENCY_NAMESPACE = 'house_budget:';

/**
 * Key del setting que capa el minteo mensual. Ahora `injectBudget` es el ÚNICO
 * método que crea fichas (injectCapital se eliminó; sellChips pasó a ser una
 * transferencia desde la Casa). El tope acota la creación por mes calendario
 * UTC para evitar fuga masiva.
 */
export const SETTING_MONTHLY_MINT_BUDGET = 'treasury.monthly_mint_budget';

/** Default alto = "sin límite práctico" hasta que el admin configure el tope. */
const DEFAULT_MONTHLY_MINT_BUDGET = 1e12;

/** La Casa no está provisionada en este tenant (seed viejo / falta migrar). */
export class HouseNotProvisionedError extends Error {
  constructor() {
    super('La cuenta Casa / tesorería no está provisionada en este tenant.');
    this.name = 'HouseNotProvisionedError';
  }
}

/**
 * `injectBudget` normal (sin `fondeo`) excedería el tope mensual de minteo.
 * Lleva el payload accionable para que el cliente entienda cuánto le queda.
 * El controller lo mapea a HTTP 409 `MINT_BUDGET_EXCEEDED`.
 */
export class MintBudgetExceededError extends Error {
  constructor(
    public readonly monthlyBudget: string,
    public readonly mintedThisMonth: string,
    public readonly available: string,
    public readonly requested: string,
  ) {
    super(
      `El fondeo de ${requested} excede el tope mensual de minteo. ` +
        `Tope: ${monthlyBudget}, minteado este mes: ${mintedThisMonth}, ` +
        `disponible: ${available}. Usá el modo fondeo para bypasear el tope.`,
    );
    this.name = 'MintBudgetExceededError';
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
    private readonly settings: TenantSettingsService,
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
   * Estado del tope mensual de minteo (treasury.monthly_mint_budget).
   *
   * Como `injectBudget` es el ÚNICO método que crea fichas, `mintedThisMonth`
   * es la suma de `house_capital_injections.amount` con `type='budget'` desde
   * el inicio del mes calendario UTC en curso. El reset es automático: al
   * cambiar de mes la ventana `createdAt >= startOfMonth` deja de contar los
   * fondeos del mes anterior.
   *
   * Toda la aritmética va en centavos (bigint) para no perder precisión con
   * montos grandes en floats.
   */
  async getMintBudgetStatus(
    db: TenantDb,
  ): Promise<{ monthlyBudget: string; mintedThisMonth: string; available: string }> {
    const monthlyBudgetNum = await this.settings.getNumeric(
      db,
      SETTING_MONTHLY_MINT_BUDGET,
      DEFAULT_MONTHLY_MINT_BUDGET,
    );

    const now = new Date();
    const startOfMonth = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
    );

    const rows = await db
      .select({
        minted: sql<string>`COALESCE(SUM(${houseCapitalInjections.amount}), 0)::text`,
      })
      .from(houseCapitalInjections)
      .where(
        and(
          eq(houseCapitalInjections.type, 'budget'),
          gte(houseCapitalInjections.createdAt, startOfMonth),
        ),
      );
    const mintedRaw = rows[0]?.minted ?? '0';

    // Aritmética en centavos (bigint) — evita drift de float en montos altos.
    const budgetCents = BigInt(Math.round(monthlyBudgetNum * 100));
    const mintedCents = this.toCents(mintedRaw);
    const availableCents =
      budgetCents - mintedCents > 0n ? budgetCents - mintedCents : 0n;

    return {
      monthlyBudget: this.fromCents(budgetCents),
      mintedThisMonth: this.fromCents(mintedCents),
      available: this.fromCents(availableCents),
    };
  }

  /**
   * Fondeo de PRESUPUESTO a la Casa (docs/16 §12, modelo "banco central").
   *
   * Es el ÚNICO método que crea fichas: el admin fija el monto y el motivo
   * directo. Exige `reason` para dejar traza clara en el audit. El propósito
   * es limitar las fichas "ilimitadas" del proveedor de juego a un techo que
   * el dueño controla — enforced por `treasury.monthly_mint_budget`.
   *
   * TOPE MENSUAL: si `!params.fondeo`, antes de mintear se chequea que
   * `mintedThisMonth + amount <= monthlyBudget`; si excede, tira
   * `MintBudgetExceededError`. Con `params.fondeo === true` el check se
   * saltea (mintea igual, queda auditado como fondeo con prefijo "FONDEO: "
   * en el reason).
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
      /**
       * Modo FONDEO: si true, bypasea el tope mensual de minteo (mintea igual
       * aunque exceda). Queda auditado como fondeo (prefijo "FONDEO: " en el
       * reason). Sigue siendo un registro type='budget'.
       */
      fondeo?: boolean;
    },
  ): Promise<HouseCapitalInjection> {
    const operatorUserId = params.operatorUserId ?? null;
    const isFondeo = params.fondeo === true;

    // TOPE MENSUAL: salvo modo fondeo, chequeamos que el monto no exceda lo
    // disponible del tope de este mes. Se hace ANTES de abrir la tx del mint
    // (lectura barata; el mint real corre después). Si excede, abortamos sin
    // tocar wallets. El fondeo bypasea a propósito (queda auditado).
    if (!isFondeo) {
      const status = await this.getMintBudgetStatus(db);
      const budgetCents = this.toCents(status.monthlyBudget);
      const mintedCents = this.toCents(status.mintedThisMonth);
      const amountCents = this.toCents(params.amount);
      if (mintedCents + amountCents > budgetCents) {
        throw new MintBudgetExceededError(
          status.monthlyBudget,
          status.mintedThisMonth,
          status.available,
          this.fromCents(amountCents),
        );
      }
    }

    // Modo fondeo: prefijamos el reason para dejar traza clara en el audit /
    // historial, manteniendo el reason del usuario.
    const effectiveReason = isFondeo
      ? `FONDEO: ${params.reason}`
      : params.reason;

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

    // N3: la key del cliente viaja cruda; internamente la envolvemos con el
    // namespace del flujo antes de guardarla en wallet_transactions. Esto
    // evita colisiones con keys de otros flows (deposit:, withdrawal:, etc.)
    // que compartirían el UNIQUE global de wallet_transactions.idempotency_key.
    const namespacedKey = `${BUDGET_IDEMPOTENCY_NAMESPACE}${params.idempotencyKey}`;

    try {
      return await db.transaction(async (txRaw) => {
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
          idempotencyKey: namespacedKey,
          reason: operatorUserId
            ? `Presupuesto a socio indep ${operatorUserId}: ${effectiveReason}`
            : `Presupuesto a la Casa: ${effectiveReason}`,
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
            reason: effectiveReason,
            bankTransactionId: null,
            mintTxId: mintTx.id,
            createdBy: params.actorUserId,
            operatorUserId,
            notes: params.notes ?? null,
          })
          .returning();

        return inserted[0]!;
      });
    } catch (err) {
      // N3: si mintToWallet reporta conflicto de idempotency, la key que
      // conoce el cliente es la CRUDA (sin namespace). Re-lanzamos con la key
      // original para que el error que ve el caller matchee el input que él
      // mandó — de otro modo vería `house_budget:<su-key>` y no sabría qué
      // hacer con eso.
      if (
        err instanceof IdempotencyConflictError &&
        err.key === namespacedKey
      ) {
        throw new IdempotencyConflictError(params.idempotencyKey);
      }
      throw err;
    }
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

  // ──────────────────────────────────────────────────────────────────────
  // Aritmética de fichas en centavos (bigint). Mismo criterio que
  // WalletService: 2 decimales, sin drift de float. Local acá para no
  // depender de internals privados de WalletService.
  // ──────────────────────────────────────────────────────────────────────

  /** "10.50" → 1050n. Acepta hasta 2 decimales. */
  private toCents(value: string): bigint {
    if (!/^-?\d+(?:\.\d{1,2})?$/.test(value.trim())) {
      throw new Error(`Monto inválido para tope de minteo: "${value}".`);
    }
    const [intPart, decPart = ''] = value.split('.');
    const padded = (decPart + '00').slice(0, 2);
    const sign = intPart!.startsWith('-') ? -1n : 1n;
    const abs = BigInt((intPart!.replace('-', '') || '0') + padded);
    return sign * abs;
  }

  /** 1050n → "10.50". */
  private fromCents(cents: bigint): string {
    const sign = cents < 0n ? '-' : '';
    const abs = cents < 0n ? -cents : cents;
    const intPart = abs / 100n;
    const decPart = (abs % 100n).toString().padStart(2, '0');
    return `${sign}${intPart}.${decPart}`;
  }
}
