/**
 * WalletService — única vía autorizada para mutar `wallets.balance`.
 *
 * Diseño:
 *   - **Toda mutación dentro de TX Postgres** (`db.transaction(...)`).
 *   - **SELECT FOR UPDATE** sobre la fila de wallet → bloquea concurrencia.
 *   - **INSERT en `wallet_transactions` + UPDATE en `wallets`** dentro de
 *     la misma TX. Si una falla, la otra se rollbackea. Atómico.
 *   - **Optimistic locking** complementario: leemos `version`, validamos
 *     antes del update, incrementamos. Cubre el caso donde otra TX ya
 *     había committed entre nuestro SELECT y nuestro UPDATE en patrones
 *     que no usen FOR UPDATE (defensa en profundidad).
 *
 * Los handlers (controller) llaman a métodos públicos como `mint()`,
 * `burn()`, etc. — el helper privado `executeTransaction()` concentra
 * el patrón TX + INSERT + UPDATE para que cada operación pública sea
 * solo política (qué tipo, qué validaciones de dominio) y no plomería.
 *
 * Idempotencia:
 *   - Validamos `idempotencyKey` UNIQUE en `wallet_transactions`. Si el
 *     INSERT cae con código 23505 (unique_violation), devolvemos la tx
 *     existente como si fuera la primera (idempotente).
 *   - El interceptor de idempotency_keys hace cache de response a nivel
 *     HTTP además de esto (defensa doble).
 */

import { Injectable } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import {
  generateUuidV7,
  roles,
  userRoles,
  wallets,
  walletTransactions,
  type NewWalletTransaction,
  type Wallet,
  type WalletTransaction,
} from '@casino/db';
import type { TenantDb } from '../tenant-resolver/tenant-context';
import {
  IdempotencyConflictError,
  InsufficientBalanceError,
  MintRoleRequiredError,
  WalletConcurrencyError,
  WalletNotFoundError,
} from './wallet.errors';

export type WalletTxType = WalletTransaction['type'];

/** Operaciones que SUMAN al balance del wallet. */
const CREDIT_TYPES = new Set<WalletTxType>([
  'mint',
  'load',
  'transfer_in',
  'win',
  'deposit',
  'bonus_grant',
  'bonus_clear',
  'jackpot_win',
  'promo_reward',
  'league_reward',
  'commission_payout',
  'fund_release',
]);

/** Operaciones que RESTAN del balance del wallet. */
const DEBIT_TYPES = new Set<WalletTxType>([
  'burn',
  'unload',
  'transfer_out',
  'bet',
  'withdrawal',
  'bonus_forfeit',
  'fund_reserve',
]);

interface ExecuteTxParams {
  walletId: string;
  type: WalletTxType;
  amount: string; // numeric(20,2) como string siempre.
  source?: string | null;
  referenceId?: string | null;
  relatedTxId?: string | null;
  counterpartyUserId?: string | null;
  idempotencyKey?: string | null;
  createdBy?: string | null;
  reason?: string | null;
  notes?: string | null;
}

interface MintOrBurnParams {
  actorUserId: string;
  amount: string;
  reason: string;
  idempotencyKey: string;
  referenceId?: string | null;
  notes?: string | null;
}

@Injectable()
export class WalletService {
  /**
   * Devuelve el wallet del user. Si no existe, lo crea con balance 0.
   * Idempotente (segura concurrencia: el UNIQUE en user_id atrapa la
   * race; reintenta el SELECT).
   */
  async getOrCreateWalletForUser(db: TenantDb, userId: string): Promise<Wallet> {
    const existing = await db.select().from(wallets).where(eq(wallets.userId, userId)).limit(1);
    if (existing[0]) return existing[0];

    try {
      const inserted = await db
        .insert(wallets)
        .values({ userId })
        .returning();
      return inserted[0]!;
    } catch (err: unknown) {
      // 23505 = unique_violation: otro request creó la wallet en el medio.
      // Re-leer y devolver.
      if (err instanceof Error && 'code' in err && (err as { code: string }).code === '23505') {
        const reread = await db
          .select()
          .from(wallets)
          .where(eq(wallets.userId, userId))
          .limit(1);
        if (reread[0]) return reread[0];
      }
      throw err;
    }
  }

  /** Lee el wallet del user (no lo crea). Tira `WalletNotFoundError`. */
  async getByUserId(db: TenantDb, userId: string): Promise<Wallet> {
    const rows = await db.select().from(wallets).where(eq(wallets.userId, userId)).limit(1);
    if (!rows[0]) throw new WalletNotFoundError(userId);
    return rows[0];
  }

  /**
   * Mint: crea fichas desde la nada en el wallet del admin actor.
   *
   * Validaciones:
   *   - Actor debe tener rol `admin_tenant` (validación adicional al permiso
   *     `wallet.mint`, defensa en profundidad).
   *   - Reason no vacío.
   *   - Amount > 0.
   *
   * Idempotente vía `idempotencyKey` UNIQUE en wallet_transactions.
   */
  async mint(db: TenantDb, params: MintOrBurnParams): Promise<WalletTransaction> {
    await this.assertAdminTenant(db, params.actorUserId);
    const wallet = await this.getOrCreateWalletForUser(db, params.actorUserId);
    return this.executeTransaction(db, {
      walletId: wallet.id,
      type: 'mint',
      amount: params.amount,
      source: 'admin_mint',
      referenceId: params.referenceId ?? null,
      idempotencyKey: params.idempotencyKey,
      createdBy: params.actorUserId,
      reason: params.reason,
      notes: params.notes ?? null,
    });
  }

  /**
   * Burn: destruye fichas del wallet del admin actor. Mismas reglas que
   * mint pero la dirección es opuesta.
   * Falla con `InsufficientBalanceError` si el wallet del admin no tiene
   * suficiente saldo.
   */
  async burn(db: TenantDb, params: MintOrBurnParams): Promise<WalletTransaction> {
    await this.assertAdminTenant(db, params.actorUserId);
    const wallet = await this.getOrCreateWalletForUser(db, params.actorUserId);
    return this.executeTransaction(db, {
      walletId: wallet.id,
      type: 'burn',
      amount: params.amount,
      source: 'admin_burn',
      referenceId: params.referenceId ?? null,
      idempotencyKey: params.idempotencyKey,
      createdBy: params.actorUserId,
      reason: params.reason,
      notes: params.notes ?? null,
    });
  }

  // ──────────────────────────────────────────────────────────────────────
  // Internals
  // ──────────────────────────────────────────────────────────────────────

  /**
   * Asegura que el `actorUserId` tiene asignado el rol `admin_tenant`.
   * Tira `MintRoleRequiredError` si no. Defensa adicional al guard de
   * permisos (que valida `wallet.mint`/`wallet.burn`).
   */
  private async assertAdminTenant(db: TenantDb, actorUserId: string): Promise<void> {
    const rows = await db
      .select({ code: roles.code })
      .from(userRoles)
      .innerJoin(roles, eq(roles.id, userRoles.roleId))
      .where(and(eq(userRoles.userId, actorUserId), eq(roles.code, 'admin_tenant')))
      .limit(1);
    if (rows.length === 0) {
      throw new MintRoleRequiredError();
    }
  }

  /**
   * Core: ejecuta una tx dentro de `db.transaction(...)`. Garantiza:
   *   - SELECT FOR UPDATE sobre el wallet (lock pesimista).
   *   - Validación de saldo si es débito.
   *   - INSERT en wallet_transactions + UPDATE en wallets, atómico.
   *   - Idempotencia: si idempotencyKey ya existe, devuelve la tx previa.
   *
   * Si el INSERT falla por unique_violation del idempotencyKey, hacemos
   * SELECT de la tx existente y la devolvemos (caso normal de retry).
   *
   * `version` del wallet se incrementa en cada update; lo usamos como
   * optimistic lock en operaciones futuras que no quieran tomar FOR UPDATE.
   */
  private async executeTransaction(
    db: TenantDb,
    params: ExecuteTxParams,
  ): Promise<WalletTransaction> {
    return db.transaction(async (tx) => {
      // 1. SELECT FOR UPDATE — bloquea la fila del wallet hasta commit.
      //    Lo hacemos PRIMERO (antes del idempotency-check) para serializar
      //    requests concurrentes sobre el mismo wallet. Sin esto, dos
      //    requests con la misma idempotencyKey podrían entrambos ver
      //    "no existe" en step 2 y luego fallar con unique_violation en
      //    el insert (race window). Tomando el lock primero, el segundo
      //    request entra al step 2 después del commit del primero y ve
      //    la fila existente.
      const lockedRows = await tx.execute(
        sql`SELECT * FROM ${wallets} WHERE id = ${params.walletId} FOR UPDATE`,
      );
      const lockedRow = (lockedRows as unknown as { rows: Wallet[] }).rows?.[0]
        ?? (lockedRows as unknown as Wallet[])[0];
      if (!lockedRow) {
        throw new WalletNotFoundError(params.walletId);
      }

      // 2. Idempotency check post-lock: si la key ya fue committedeada por
      //    otra TX previa, devolvemos la tx existente — pero sólo si los
      //    parámetros relevantes coinciden. Si difieren, es un mal uso de
      //    la key (mismo key con operación distinta) → tiramos
      //    `IdempotencyConflictError` (HTTP 409). Doc `§11`.
      if (params.idempotencyKey) {
        const existing = await tx
          .select()
          .from(walletTransactions)
          .where(eq(walletTransactions.idempotencyKey, params.idempotencyKey))
          .limit(1);
        if (existing[0]) {
          // Postgres normaliza `numeric(20,2)` a 2 decimales fijos ("33"
          // vuelve como "33.00"). Comparamos por valor (centavos) no por
          // literal string.
          const sameAmount =
            this.toCents(existing[0].amount) === this.toCents(params.amount);
          const match =
            existing[0].type === params.type &&
            sameAmount &&
            (existing[0].reason ?? null) === (params.reason ?? null) &&
            existing[0].walletId === params.walletId;
          if (!match) {
            throw new IdempotencyConflictError(params.idempotencyKey);
          }
          return existing[0];
        }
      }

      const balanceBefore = lockedRow.balance;
      const direction = this.directionFor(params.type);
      const balanceAfter = this.computeBalanceAfter(balanceBefore, params.amount, direction);

      // 3. Validar saldo en débitos.
      if (direction === 'debit' && Number(balanceAfter) < 0) {
        throw new InsufficientBalanceError(balanceBefore, params.amount);
      }

      // 4. INSERT en wallet_transactions.
      const newTx: NewWalletTransaction = {
        id: generateUuidV7(),
        walletId: params.walletId,
        type: params.type,
        amount: params.amount,
        balanceAfter,
        source: params.source ?? null,
        referenceId: params.referenceId ?? null,
        relatedTxId: params.relatedTxId ?? null,
        counterpartyUserId: params.counterpartyUserId ?? null,
        idempotencyKey: params.idempotencyKey ?? null,
        createdBy: params.createdBy ?? null,
        reason: params.reason ?? null,
        notes: params.notes ?? null,
      };

      let insertedTx: WalletTransaction;
      try {
        const inserted = await tx.insert(walletTransactions).values(newTx).returning();
        insertedTx = inserted[0]!;
      } catch (err: unknown) {
        // 23505 = unique_violation: idempotencyKey ya existía (race entre
        // step 1 y este insert). Releemos.
        if (
          err instanceof Error &&
          'code' in err &&
          (err as { code: string }).code === '23505' &&
          params.idempotencyKey
        ) {
          const existing = await tx
            .select()
            .from(walletTransactions)
            .where(eq(walletTransactions.idempotencyKey, params.idempotencyKey))
            .limit(1);
          if (existing[0]) return existing[0];
        }
        throw err;
      }

      // 5. UPDATE wallets.balance + version + updated_at.
      const updated = await tx
        .update(wallets)
        .set({
          balance: balanceAfter,
          version: sql`${wallets.version} + 1`,
          updatedAt: new Date(),
        })
        .where(and(eq(wallets.id, params.walletId), eq(wallets.version, lockedRow.version)))
        .returning();

      if (updated.length === 0) {
        // Otro proceso ganó el lock (no debería pasar con FOR UPDATE pero
        // mantenemos la red por si alguna ruta futura no toma el lock).
        throw new WalletConcurrencyError(params.walletId);
      }

      return insertedTx;
    });
  }

  private directionFor(type: WalletTxType): 'credit' | 'debit' | 'neutral' {
    if (CREDIT_TYPES.has(type)) return 'credit';
    if (DEBIT_TYPES.has(type)) return 'debit';
    // 'adjustment' y 'rollback' son neutrales acá — la dirección la maneja
    // el caller con un type ad-hoc o un pair de tx.
    return 'neutral';
  }

  /**
   * Suma/resta `amount` a `balanceBefore` según `direction`. Operación
   * con strings para preservar precisión decimal exacta (numeric(20,2)).
   *
   * Usamos BigInt sobre representación en centavos para evitar errores
   * de float (0.1 + 0.2 = 0.30000000000000004).
   */
  private computeBalanceAfter(
    balanceBefore: string,
    amount: string,
    direction: 'credit' | 'debit' | 'neutral',
  ): string {
    const beforeCents = this.toCents(balanceBefore);
    const amountCents = this.toCents(amount);
    let afterCents: bigint;
    if (direction === 'credit') afterCents = beforeCents + amountCents;
    else if (direction === 'debit') afterCents = beforeCents - amountCents;
    else afterCents = beforeCents;
    return this.fromCents(afterCents);
  }

  /** "10.50" → 1050n (centavos). Acepta números positivos con hasta 2 decimales. */
  private toCents(value: string): bigint {
    const match = /^-?\d+(?:\.(\d{1,2}))?$/.exec(value.trim());
    if (!match) {
      throw new Error(`Monto inválido para wallet: "${value}".`);
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
