/**
 * BranchesService — Sprint 51.
 *
 * Gestiona el flag `is_independent_branch` sobre socios + la operación
 * de "venta de fichas" del tenant al socio independent.
 *
 * Modelo (decidido por dueño 2026-05-20):
 *   - Default: socios son DEPENDENT. Operan contra el banco del tenant
 *     y reciben commissions vía el flujo accrued/settle del Sprint 50.
 *   - Toggle a INDEPENDENT: el socio pasa a operar con su propio banco.
 *     El admin le configura `branchBankAccount` + `branchChipsPricePerUnit`.
 *     Las commissions upstream NO se acumulan (modelo "pago por adelantado":
 *     el socio ya pagó al comprar las fichas al precio mayorista).
 *   - Sell-chips: el admin mintea fichas DIRECTO al wallet del socio
 *     independent con source='branch_chip_sale' y reason que registra
 *     `amountFiat = amountChips * branchChipsPricePerUnit`. El intercambio
 *     real de plata es offline (el socio le transfiere al admin por fuera).
 *
 * Sensibilidad: ambas operaciones (toggle + sell) son admin-only,
 * audit severity:high. NO delegables vía override (gate de permisos).
 */

import { Injectable, Logger } from '@nestjs/common';
import { and, asc, desc, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import {
  roles,
  userPermissionOverrides,
  userRoles,
  users,
  wallets,
  walletTransactions,
  type User,
} from '@casino/db';
import type { TenantDb } from '../tenant-resolver/tenant-context';
import { WalletService } from '../wallet/wallet.service';
import {
  BranchInvalidPriceError,
  BranchNotASocioError,
  BranchNotIndependentError,
  BranchPriceNotConfiguredError,
  BranchSocioNotFoundError,
} from './branches.errors';

export interface ToggleIndependenceParams {
  socioId: string;
  isIndependent: boolean;
  branchBankAccount?: string | null;
  branchChipsPricePerUnit?: string | null;
}

export interface SellChipsParams {
  socioId: string;
  actorUserId: string;
  amountChips: string;
  idempotencyKey: string;
  notes?: string | null;
}

export interface SellChipsResult {
  socioId: string;
  amountChips: string;
  pricePerUnit: string;
  amountFiat: string;
  walletTxId: string;
  newBalance: string;
}

/** Row del listado de sucursales independientes. */
export interface BranchListRow {
  socioId: string;
  username: string;
  displayName: string;
  status: string;
  branchBankAccount: string;
  branchChipsPricePerUnit: string;
  /** Balance actual del wallet del socio (chips). */
  walletBalance: string;
  /** Total de chips vendidas en las últimas 30 días (rolling). */
  chipsSold30d: string;
  /** Equivalente fiat acumulado en las últimas 30 días. */
  fiatSold30d: string;
  /** Última venta (o null si nunca le vendieron). */
  lastSaleAt: Date | null;
}

/** Row del summary de ventas agregado por socio en un rango. */
export interface BranchSalesSummaryRow {
  socioId: string;
  username: string;
  displayName: string;
  branchChipsPricePerUnit: string | null;
  salesCount: number;
  totalChipsSold: string;
  totalFiatSold: string;
  lastSaleAt: Date | null;
}

/** Detalle de una venta puntual en el history. */
export interface BranchSaleEntry {
  walletTxId: string;
  amountChips: string;
  /** Calculado: amountChips * pricePerUnit congelado en la reason. */
  amountFiat: string;
  pricePerUnit: string;
  reason: string | null;
  createdAt: Date;
  createdByUserId: string | null;
  createdByUsername: string | null;
}

/** Info del socio para el endpoint /mine (self-view). */
export interface MyBranchInfo {
  isIndependent: boolean;
  bankAccount: string | null;
  pricePerUnit: string | null;
  walletBalance: string;
  totals: {
    chipsSoldAllTime: string;
    fiatSoldAllTime: string;
    salesCount: number;
  };
  recentSales: BranchSaleEntry[];
}

/**
 * Sprint 51.2 + amp. 2026-07: permisos que el socio independiente recibe
 * automáticamente al activar el flag. Le permiten armar su equipo (usuarios +
 * empleados), operar la ficha de sus clientes, aprobar/rechazar sus depósitos
 * y retiros, y gestionar bonos de su red. NO incluye `users.view_all` (que
 * expondría el tenant entero) ni `force_clear` de bonos (destructivo).
 *
 * El socio no queda con `users.view_all` ni con permisos del núcleo del
 * tenant — sigue aislado a su sub-red por el ScopeGuard y por la poda
 * automática de sub-red independiente en el listado del admin.
 */
const INDEPENDENT_BRANCH_AUTO_PERMISSIONS = [
  // Usuarios (armar su red)
  'users.view_any',
  'users.create',
  'users.edit',
  'users.ban',
  'users.export',
  // Wallet (operar fichas con clientes)
  'wallet.load',
  'wallet.unload',
  'wallet.view_any',
  // Depósitos
  'deposits.view',
  'deposits.approve',
  'deposits.reject',
  // Retiros
  'withdrawals.view',
  'withdrawals.approve',
  'withdrawals.reject',
  'withdrawals.mark_paid',
  // Bonos (ya estaban)
  'bonuses.view',
  'bonuses.view_any',
  'bonuses.create_definition',
  'bonuses.edit_definition',
  'bonuses.grant_manual',
  'bonuses.cancel',
  'bonuses.export',
  'bonuses.export_definitions',
] as const;

@Injectable()
export class BranchesService {
  private readonly logger = new Logger(BranchesService.name);

  constructor(private readonly walletService: WalletService) {}

  /**
   * Activa/desactiva el modo sucursal independiente para un socio.
   *
   * - Valida que el user existe y tiene rol 'socio'.
   * - Si isIndependent=true: branchBankAccount y branchChipsPricePerUnit
   *   son obligatorios y se persisten.
   * - Si isIndependent=false: limpia los dos campos.
   */
  async toggleIndependence(
    db: TenantDb,
    params: ToggleIndependenceParams,
  ): Promise<User> {
    const user = await this.assertSocio(db, params.socioId);

    if (params.isIndependent) {
      if (!params.branchBankAccount) {
        throw new BranchInvalidPriceError('branchBankAccount es obligatorio');
      }
      if (!params.branchChipsPricePerUnit) {
        throw new BranchInvalidPriceError('branchChipsPricePerUnit es obligatorio');
      }
      this.assertPriceValid(params.branchChipsPricePerUnit);
    }

    const updated = await db
      .update(users)
      .set({
        isIndependentBranch: params.isIndependent,
        branchBankAccount: params.isIndependent ? params.branchBankAccount! : null,
        branchChipsPricePerUnit: params.isIndependent
          ? params.branchChipsPricePerUnit!
          : null,
        updatedAt: new Date(),
      })
      .where(eq(users.id, user.id))
      .returning();

    // Sprint 51.2: el socio independent recibe automáticamente el set
    // de permisos `bonuses.*` necesarios para crear plantillas propias,
    // otorgarlas a su downstream y manejarlas. Al desactivar, se
    // revocan esos overrides (el rol 'socio' base no los trae).
    if (params.isIndependent) {
      await this.grantIndependentPermissions(db, user.id);
    } else {
      await this.revokeIndependentPermissions(db, user.id);
    }

    return updated[0]!;
  }

  /**
   * Inserta los overrides 'grant' para el set completo de permisos que un
   * socio independiente necesita para armar su equipo y operar su sub-red
   * (users + wallet + deposits + withdrawals + bonuses). Definidos en
   * INDEPENDENT_BRANCH_AUTO_PERMISSIONS. Idempotente vía ON CONFLICT DO NOTHING
   * (PK = userId + permissionCode).
   */
  private async grantIndependentPermissions(db: TenantDb, socioId: string): Promise<void> {
    const values = INDEPENDENT_BRANCH_AUTO_PERMISSIONS.map((code) => ({
      userId: socioId,
      permissionCode: code,
      effect: 'grant' as const,
      grantedBy: null,
      reason: 'Auto-grant al activar sucursal independiente (users/wallet/deposits/withdrawals/bonuses).',
    }));
    await db.insert(userPermissionOverrides).values(values).onConflictDoNothing();
    this.logger.log(
      `Socio ${socioId} marcado independiente → ${values.length} permisos operativos otorgados.`,
    );
  }

  /**
   * Revoca los overrides que se otorgaron al activar. Hard delete del row (no
   * inserta un 'revoke') — preserva el set original (rol base) para el socio
   * cuando deja de ser independiente.
   */
  private async revokeIndependentPermissions(db: TenantDb, socioId: string): Promise<void> {
    await db
      .delete(userPermissionOverrides)
      .where(
        and(
          eq(userPermissionOverrides.userId, socioId),
          inArray(
            userPermissionOverrides.permissionCode,
            [...INDEPENDENT_BRANCH_AUTO_PERMISSIONS],
          ),
          eq(userPermissionOverrides.effect, 'grant'),
        ),
      );
    this.logger.log(
      `Socio ${socioId} desactivado → bonuses.* perms revocados.`,
    );
  }

  /**
   * Vende fichas al socio independent: mintea al wallet del socio.
   *
   * - Valida que el socio existe, es socio, está marcado independent
   *   y tiene precio configurado.
   * - Calcula amountFiat = amountChips * pricePerUnit (con 2 decimales).
   * - Mintea via WalletService.mintToWallet con idempotency garantizada
   *   por `branch_chip_sale:<idempotencyKey>`.
   */
  async sellChips(db: TenantDb, params: SellChipsParams): Promise<SellChipsResult> {
    const socio = await this.assertSocio(db, params.socioId);
    if (!socio.isIndependentBranch) {
      throw new BranchNotIndependentError(socio.id);
    }
    if (!socio.branchChipsPricePerUnit) {
      throw new BranchPriceNotConfiguredError(socio.id);
    }

    const amountChipsNum = Number(params.amountChips);
    const priceNum = Number(socio.branchChipsPricePerUnit);
    if (!isFinite(amountChipsNum) || amountChipsNum <= 0) {
      throw new BranchInvalidPriceError(`amountChips inválido: ${params.amountChips}`);
    }
    if (!isFinite(priceNum) || priceNum <= 0) {
      throw new BranchInvalidPriceError(socio.branchChipsPricePerUnit);
    }
    const amountFiat = (amountChipsNum * priceNum).toFixed(2);

    const wallet = await this.walletService.getOrCreateWalletForUser(db, socio.id);
    const idempotencyKey = `branch_chip_sale:${params.idempotencyKey}`;
    const walletTx = await this.walletService.mintToWallet(db, {
      walletId: wallet.id,
      amount: params.amountChips,
      source: 'branch_chip_sale',
      referenceId: socio.id,
      idempotencyKey,
      reason: `Venta de fichas a sucursal ${socio.username} — ${amountFiat} fiat al precio ${socio.branchChipsPricePerUnit}/ficha${params.notes ? ` — ${params.notes}` : ''}`,
      createdBy: params.actorUserId,
      counterpartyUserId: params.actorUserId,
    });

    return {
      socioId: socio.id,
      amountChips: params.amountChips,
      pricePerUnit: socio.branchChipsPricePerUnit,
      amountFiat,
      walletTxId: walletTx.id,
      newBalance: walletTx.balanceAfter,
    };
  }

  // ──────────────────────────────────────────────────────────────────────
  // Listados + reporting (Sprint 51.1)
  // ──────────────────────────────────────────────────────────────────────

  /**
   * Lista todas las sucursales independientes del tenant. Para cada socio:
   *   - su config (bankAccount, price).
   *   - balance actual del wallet.
   *   - chips + fiat vendidos en los últimos 30 días.
   *   - timestamp de la última venta.
   *
   * Sin paginación por ahora (los socios independent son pocos).
   */
  async listIndependent(db: TenantDb): Promise<BranchListRow[]> {
    const since30d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    // Subquery 1: agregado de ventas 30d por wallet.
    // Hacemos un LEFT JOIN entre users (independent) → wallets → ventas 30d.
    // El "fiat" lo extraemos parseando el reason — para evitar eso, hacemos
    // la mate en JS leyendo amount + price del row.
    const independentSocios = await db
      .select({
        id: users.id,
        username: users.username,
        displayName: users.displayName,
        status: users.status,
        branchBankAccount: users.branchBankAccount,
        branchChipsPricePerUnit: users.branchChipsPricePerUnit,
        walletId: wallets.id,
        walletBalance: wallets.balance,
      })
      .from(users)
      .leftJoin(wallets, eq(wallets.userId, users.id))
      .where(eq(users.isIndependentBranch, true))
      .orderBy(asc(users.username));

    if (independentSocios.length === 0) return [];

    // Agregado por wallet de ventas 30d.
    const walletIds = independentSocios
      .map((s) => s.walletId)
      .filter((id): id is string => id !== null);
    if (walletIds.length === 0) {
      return independentSocios.map((s) => ({
        socioId: s.id,
        username: s.username,
        displayName: s.displayName,
        status: s.status,
        branchBankAccount: s.branchBankAccount ?? '',
        branchChipsPricePerUnit: s.branchChipsPricePerUnit ?? '0',
        walletBalance: s.walletBalance ?? '0',
        chipsSold30d: '0',
        fiatSold30d: '0.00',
        lastSaleAt: null,
      }));
    }

    const salesAgg = await db
      .select({
        walletId: walletTransactions.walletId,
        totalChips: sql<string>`COALESCE(SUM(${walletTransactions.amount}), 0)::text`,
        lastSaleAt: sql<Date | null>`MAX(${walletTransactions.createdAt})`,
      })
      .from(walletTransactions)
      .where(
        and(
          eq(walletTransactions.source, 'branch_chip_sale'),
          gte(walletTransactions.createdAt, since30d),
          inArray(walletTransactions.walletId, walletIds),
        ),
      )
      .groupBy(walletTransactions.walletId);

    const aggByWallet = new Map(salesAgg.map((r) => [r.walletId, r]));

    return independentSocios.map((s) => {
      const agg = s.walletId ? aggByWallet.get(s.walletId) : undefined;
      const chips30d = agg?.totalChips ?? '0';
      const price = s.branchChipsPricePerUnit ?? '0';
      const fiat30d = (Number(chips30d) * Number(price)).toFixed(2);
      return {
        socioId: s.id,
        username: s.username,
        displayName: s.displayName,
        status: s.status,
        branchBankAccount: s.branchBankAccount ?? '',
        branchChipsPricePerUnit: price,
        walletBalance: s.walletBalance ?? '0',
        chipsSold30d: chips30d,
        fiatSold30d: fiat30d,
        lastSaleAt: agg?.lastSaleAt ?? null,
      };
    });
  }

  /**
   * Sales summary: agrega ventas de fichas por socio en un rango opcional.
   * Devuelve socios que tienen al menos 1 venta en el rango.
   *
   * El cálculo de `totalFiatSold` usa el `branchChipsPricePerUnit` ACTUAL
   * del socio (no el congelado en cada venta). Si el admin cambió el
   * precio mid-rango, el agregado será aproximado. Para una versión exacta
   * habría que extraer el precio del reason de cada tx — costoso y rara
   * vez útil. Si emerge necesidad, agregar `wallet_transactions.metadata
   * jsonb` con `{ pricePerUnit }` snap-shotted al insertar.
   */
  async salesSummary(
    db: TenantDb,
    filters: { from?: Date; to?: Date },
  ): Promise<{
    data: BranchSalesSummaryRow[];
    totals: {
      salesCount: number;
      totalChipsSold: string;
      totalFiatSold: string;
    };
  }> {
    const conds = [eq(walletTransactions.source, 'branch_chip_sale')];
    if (filters.from) conds.push(gte(walletTransactions.createdAt, filters.from));
    if (filters.to) conds.push(lte(walletTransactions.createdAt, filters.to));

    const rows = await db
      .select({
        userId: wallets.userId,
        username: users.username,
        displayName: users.displayName,
        branchChipsPricePerUnit: users.branchChipsPricePerUnit,
        salesCount: sql<number>`COUNT(*)::int`,
        totalChips: sql<string>`COALESCE(SUM(${walletTransactions.amount}), 0)::text`,
        lastSaleAt: sql<Date | null>`MAX(${walletTransactions.createdAt})`,
      })
      .from(walletTransactions)
      .innerJoin(wallets, eq(wallets.id, walletTransactions.walletId))
      .innerJoin(users, eq(users.id, wallets.userId))
      .where(and(...conds))
      .groupBy(
        wallets.userId,
        users.username,
        users.displayName,
        users.branchChipsPricePerUnit,
      )
      .orderBy(desc(sql`SUM(${walletTransactions.amount})`));

    const data: BranchSalesSummaryRow[] = rows.map((r) => {
      const price = r.branchChipsPricePerUnit ?? '0';
      const totalFiat = (Number(r.totalChips) * Number(price)).toFixed(2);
      return {
        socioId: r.userId,
        username: r.username,
        displayName: r.displayName,
        branchChipsPricePerUnit: r.branchChipsPricePerUnit,
        salesCount: r.salesCount,
        totalChipsSold: r.totalChips,
        totalFiatSold: totalFiat,
        lastSaleAt: r.lastSaleAt,
      };
    });

    const totalChips = data.reduce((acc, r) => acc + Number(r.totalChipsSold), 0);
    const totalFiat = data.reduce((acc, r) => acc + Number(r.totalFiatSold), 0);
    const totalCount = data.reduce((acc, r) => acc + r.salesCount, 0);

    return {
      data,
      totals: {
        salesCount: totalCount,
        totalChipsSold: totalChips.toFixed(0),
        totalFiatSold: totalFiat.toFixed(2),
      },
    };
  }

  /**
   * Self-view para el socio: su config + history de chip sales + totales
   * all-time. Si el user no es socio, devuelve `isIndependent: false`
   * con totales 0 (no es error — el endpoint es seguro de llamar para
   * cualquier user).
   */
  async myBranchInfo(
    db: TenantDb,
    userId: string,
    recentLimit = 20,
  ): Promise<MyBranchInfo> {
    const userRows = await db
      .select()
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    const user = userRows[0];
    if (!user) {
      throw new BranchSocioNotFoundError(userId);
    }

    const wallet = await this.walletService.getOrCreateWalletForUser(db, userId);

    // Totals all-time (sin rango).
    const totalsRows = await db
      .select({
        count: sql<number>`COUNT(*)::int`,
        totalChips: sql<string>`COALESCE(SUM(${walletTransactions.amount}), 0)::text`,
      })
      .from(walletTransactions)
      .where(
        and(
          eq(walletTransactions.walletId, wallet.id),
          eq(walletTransactions.source, 'branch_chip_sale'),
        ),
      );
    const totals = totalsRows[0]!;

    // Recent sales (últimas N).
    const recentRows = await db
      .select({
        id: walletTransactions.id,
        amount: walletTransactions.amount,
        reason: walletTransactions.reason,
        createdAt: walletTransactions.createdAt,
        createdBy: walletTransactions.createdBy,
        createdByUsername: users.username,
      })
      .from(walletTransactions)
      .leftJoin(users, eq(users.id, walletTransactions.createdBy))
      .where(
        and(
          eq(walletTransactions.walletId, wallet.id),
          eq(walletTransactions.source, 'branch_chip_sale'),
        ),
      )
      .orderBy(desc(walletTransactions.createdAt))
      .limit(Math.min(Math.max(recentLimit, 1), 100));

    const price = user.branchChipsPricePerUnit ?? '0';
    const recentSales: BranchSaleEntry[] = recentRows.map((r) => {
      const fiat = (Number(r.amount) * Number(price)).toFixed(2);
      return {
        walletTxId: r.id,
        amountChips: r.amount,
        amountFiat: fiat,
        pricePerUnit: price,
        reason: r.reason,
        createdAt: r.createdAt,
        createdByUserId: r.createdBy,
        createdByUsername: r.createdByUsername ?? null,
      };
    });

    const fiatAllTime = (Number(totals.totalChips) * Number(price)).toFixed(2);

    return {
      isIndependent: !!user.isIndependentBranch,
      bankAccount: user.branchBankAccount ?? null,
      pricePerUnit: user.branchChipsPricePerUnit ?? null,
      walletBalance: wallet.balance,
      totals: {
        chipsSoldAllTime: totals.totalChips,
        fiatSoldAllTime: fiatAllTime,
        salesCount: totals.count,
      },
      recentSales,
    };
  }

  // ──────────────────────────────────────────────────────────────────────
  // helpers
  // ──────────────────────────────────────────────────────────────────────

  private async assertSocio(db: TenantDb, userId: string): Promise<User> {
    const userRows = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    const user = userRows[0];
    if (!user) throw new BranchSocioNotFoundError(userId);

    const roleRows = await db
      .select({ code: roles.code })
      .from(userRoles)
      .innerJoin(roles, eq(roles.id, userRoles.roleId))
      .where(and(eq(userRoles.userId, userId), eq(roles.code, 'socio')))
      .limit(1);
    if (!roleRows[0]) throw new BranchNotASocioError(userId);
    return user;
  }

  private assertPriceValid(price: string): void {
    const n = Number(price);
    if (!isFinite(n) || n <= 0) {
      throw new BranchInvalidPriceError(price);
    }
  }
}
