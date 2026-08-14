/**
 * WalletStatsService — agregados sobre `wallet_transactions`.
 *
 * Diseño:
 *   - Read-only. Toda mutación sobre wallets va por WalletService (área crítica).
 *   - Joins con `wallets`+`users`+`user_roles`+`roles` para resolver
 *     "owner user" del wallet y "actor" que ejecutó la operación.
 *   - Roles son MULTI: un user puede ser admin_tenant + socio. Para reportes
 *     usamos el rol "primario" — el primero alfabéticamente excluyendo
 *     usuario_final si tiene otro. Si tiene SOLO usuario_final, ese es.
 *   - Scope: si actor tiene `wallet_stats.view_any` ve todo. Si solo tiene
 *     `wallet_stats.view_own_network`, filtra al subset de users en su
 *     descendencia jerárquica.
 *
 * Tamaño: para volumen MVP (< 1M tx por tenant) queries directas con
 * índices alcanzan. Si crece, considerar tabla materializada `wallet_stats_daily`
 * con cron incremental.
 */

import { Injectable } from '@nestjs/common';
import {
  and,
  eq,
  gte,
  inArray,
  lte,
  sql,
  type AnyColumn,
  type SQL,
} from 'drizzle-orm';
import {
  bankTransactions,
  gameRounds,
  roles,
  userBonuses,
  userRoles,
  users,
  wallets,
  walletTransactions,
} from '@casino/db';
import type { TenantDb } from '../tenant-resolver/tenant-context';

export type WalletTxType =
  | 'mint' | 'burn' | 'load' | 'unload'
  | 'transfer_in' | 'transfer_out'
  | 'bet' | 'win' | 'rollback' | 'adjustment'
  | 'bonus_grant' | 'bonus_clear' | 'bonus_forfeit'
  | 'bonus_funding' | 'bonus_funding_revert'
  | 'bonus_credit' | 'bonus_debit'
  | 'deposit' | 'withdrawal'
  | 'jackpot_win' | 'promo_reward' | 'league_reward'
  | 'commission_payout' | 'fund_reserve' | 'fund_release';

/**
 * Movement types categorizados por dirección financiera para summaries.
 * Mantener en sync con el enum `walletTxTypeEnum`.
 */
const INFLOW_TYPES: WalletTxType[] = [
  'mint', 'load', 'transfer_in', 'win', 'deposit',
  'bonus_grant', 'bonus_clear', 'bonus_funding_revert',
  'bonus_credit',
  'jackpot_win', 'promo_reward', 'league_reward',
  'commission_payout', 'fund_release',
];
const OUTFLOW_TYPES: WalletTxType[] = [
  'burn', 'unload', 'transfer_out', 'bet', 'withdrawal',
  'bonus_forfeit', 'bonus_funding', 'bonus_debit', 'fund_reserve',
];

export interface ListMovementsFilters {
  types?: WalletTxType[];
  /** Filtrar por rol del owner del wallet (no del actor). */
  ownerRoles?: string[];
  dateFrom?: Date;
  dateTo?: Date;
  /** Owner del wallet — quien recibe o pierde fichas. */
  userId?: string;
  /** Actor que ejecutó (created_by). */
  actorId?: string;
  minAmount?: number;
  maxAmount?: number;
  limit?: number;
  offset?: number;
  /** Si se pasa, restringe el resultado a estos userIds (owner). */
  restrictToUserIds?: string[];
}

export interface MovementRow {
  id: string;
  type: WalletTxType;
  amount: string;
  balanceAfter: string;
  createdAt: Date;
  source: string | null;
  reason: string | null;
  notes: string | null;
  idempotencyKey: string | null;
  /** Owner del wallet (el que recibe/pierde fichas). */
  ownerUserId: string;
  ownerUsername: string;
  ownerDisplayName: string;
  ownerRole: string | null;
  /** Actor que ejecutó la operación (NULL para tx de sistema). */
  actorUserId: string | null;
  actorUsername: string | null;
  actorRole: string | null;
  /** Otro user involucrado (ej: en transfer, el otro lado). */
  counterpartyUserId: string | null;
  /** Transferencia bancaria conciliada (solo cargas/retiros manuales). NULL si no. */
  bankTxId: string | null;
  bankTxAmount: string | null;
  bankTxReference: string | null;
  bankTxSender: string | null;
  bankTxBank: string | null;
  bankTxReceivedAt: Date | null;
  /** Direction derivada del type — útil para colorear en UI. */
  direction: 'in' | 'out';
}

export interface MovementsPage {
  data: MovementRow[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
  /** Totales sobre TODOS los registros filtrados (no solo la página). */
  totalIn: string;
  totalOut: string;
  net: string;
  /** Settlement con proveedores: apuestas vs ganancias. */
  totalBet: string;
  totalWon: string;
  netGaming: string;
}

export type BucketKey = 'today' | '7d' | '30d' | 'custom';

export interface SummaryBucket {
  bucket: BucketKey;
  dateFrom: Date;
  dateTo: Date;
  totalIn: string;
  totalOut: string;
  net: string;
  txCount: number;
  countByType: Record<string, number>;
  amountByType: Record<string, string>;
}

export interface ByRoleRow {
  role: string;
  inflow: string;
  outflow: string;
  net: string;
  txCount: number;
  uniqueUsers: number;
}

// ── Auditoría por ámbito (netwin por red) ──────────────────────────────

export interface ScopedAuditFilters {
  /** Owner del wallet ∈ este conjunto. undefined = toda la plataforma. */
  restrictToUserIds?: string[];
  dateFrom?: Date;
  dateTo?: Date;
}

/**
 * Netwin (GGR) de un ámbito. Incluye bonos en lo apostado (`bonus_debit`)
 * porque el proveedor cobra por ficha apostada, sea ficha normal o de bono.
 */
export interface NetwinResult {
  /** Σ bet + bonus_debit. */
  apostado: string;
  /** Σ win + jackpot_win. */
  ganado: string;
  /** apostado − ganado. */
  netwin: string;
  /** ganado / apostado (RTP observado). null si apostado = 0. */
  rtp: string | null;
}

export interface ScopedAudit {
  dateFrom: Date | null;
  dateTo: Date | null;
  juego: NetwinResult;
  /** Minorista (jugadores): plata real de punta. */
  plata: { depositos: string; retiros: string; neto: string };
  /** Mayorista (operadores): distribución de fichas dentro del ámbito. */
  fichas: {
    cargasOperadores: string;
    descargasOperadores: string;
    neto: string;
    cargasJugadores: string;
  };
  bonos: { otorgados: string; liberados: string; perdidos: string };
  /** Fichas en manos de JUGADORES del ámbito (balance activo, snapshot). */
  circulacion: string;
}

export interface IndependentSocio {
  id: string;
  username: string;
  displayName: string;
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

@Injectable()
export class WalletStatsService {
  /**
   * Lista paginada de movimientos con filtros + enrichment.
   *
   * Comportamiento NULL-safe:
   *   - `ownerRole` puede ser NULL si el user no tiene roles (anómalo).
   *   - `actorUserId` es NULL para tx de sistema (cron, jobs).
   */
  async listMovements(
    db: TenantDb,
    filters: ListMovementsFilters,
    maxLimit?: number,
  ): Promise<MovementsPage> {
    const limit = Math.min(filters.limit ?? DEFAULT_LIMIT, maxLimit ?? MAX_LIMIT);
    const offset = Math.max(filters.offset ?? 0, 0);

    const where = this.buildWhere(filters);

    // Total (count separado, costo aceptable con el index wallet_tx_type_created).
    const totalRow = await db
      .select({ count: sql<number>`COUNT(*)::int` })
      .from(walletTransactions)
      .innerJoin(wallets, eq(walletTransactions.walletId, wallets.id))
      .innerJoin(users, eq(wallets.userId, users.id))
      .where(where);
    const total = totalRow[0]?.count ?? 0;

    // Agregados de totales sobre TODOS los registros filtrados (no solo la página).
    // Fetch ligero: solo type + amount, sin joins pesados.
    const allTxRows = await db
      .select({
        type: walletTransactions.type,
        amount: walletTransactions.amount,
      })
      .from(walletTransactions)
      .innerJoin(wallets, eq(walletTransactions.walletId, wallets.id))
      .where(where);
    let totalInNum = 0;
    let totalOutNum = 0;
    let totalBetNum = 0;
    let totalWonNum = 0;
    for (const row of allTxRows) {
      const amt = Number(row.amount);
      if (INFLOW_TYPES.includes(row.type as any)) {
        totalInNum += amt;
      } else if (OUTFLOW_TYPES.includes(row.type as any)) {
        totalOutNum += amt;
      }
      if (row.type === 'bet' || row.type === 'bonus_debit') totalBetNum += amt;
      if (row.type === 'win' || row.type === 'jackpot_win') totalWonNum += amt;
    }

    // Data — page con joins. ownerRole y actorRole se calculan via subquery
    // que toma el primer rol no-usuario_final (o usuario_final si es lo único).
    const ownerRoleSql = sql<string | null>`(
      SELECT r.code FROM ${userRoles} ur
      INNER JOIN ${roles} r ON r.id = ur.role_id
      WHERE ur.user_id = ${wallets.userId}
      ORDER BY CASE WHEN r.code = 'usuario_final' THEN 1 ELSE 0 END, r.code
      LIMIT 1
    )`.as('owner_role');

    const actorRoleSql = sql<string | null>`(
      SELECT r.code FROM ${userRoles} ur
      INNER JOIN ${roles} r ON r.id = ur.role_id
      WHERE ur.user_id = ${walletTransactions.createdBy}
      ORDER BY CASE WHEN r.code = 'usuario_final' THEN 1 ELSE 0 END, r.code
      LIMIT 1
    )`.as('actor_role');

    const actorUsernameSql = sql<string | null>`(
      SELECT u.username FROM ${users} u
      WHERE u.id = ${walletTransactions.createdBy}
      LIMIT 1
    )`.as('actor_username');

    const rows = await db
      .select({
        id: walletTransactions.id,
        type: walletTransactions.type,
        amount: walletTransactions.amount,
        balanceAfter: walletTransactions.balanceAfter,
        createdAt: walletTransactions.createdAt,
        source: walletTransactions.source,
        reason: walletTransactions.reason,
        notes: walletTransactions.notes,
        idempotencyKey: walletTransactions.idempotencyKey,
        ownerUserId: wallets.userId,
        ownerUsername: users.username,
        ownerDisplayName: users.displayName,
        ownerRole: ownerRoleSql,
        actorUserId: walletTransactions.createdBy,
        actorUsername: actorUsernameSql,
        actorRole: actorRoleSql,
        counterpartyUserId: walletTransactions.counterpartyUserId,
        bankTxId: bankTransactions.id,
        bankTxAmount: bankTransactions.amount,
        bankTxReference: bankTransactions.reference,
        bankTxSender: bankTransactions.senderName,
        bankTxBank: bankTransactions.bankName,
        bankTxReceivedAt: bankTransactions.receivedAt,
      })
      .from(walletTransactions)
      .innerJoin(wallets, eq(walletTransactions.walletId, wallets.id))
      .innerJoin(users, eq(wallets.userId, users.id))
      .leftJoin(
        bankTransactions,
        eq(bankTransactions.matchedManualTxId, walletTransactions.id),
      )
      .where(where)
      .orderBy(sql`${walletTransactions.createdAt} DESC`)
      .limit(limit)
      .offset(offset);

    // Si pidió ownerRoles, filtramos en memoria (el WHERE no puede meter
    // el subquery sin que se rompa el plan). Costo aceptable: page de
    // máx 200 filas.
    let data = rows.map(
      (r): MovementRow => ({
        ...r,
        type: r.type,
        direction: this.directionOf(r.type),
      }),
    );
    if (filters.ownerRoles?.length) {
      data = data.filter(
        (r) => r.ownerRole && filters.ownerRoles!.includes(r.ownerRole),
      );
    }

    return {
      data,
      total,
      limit,
      offset,
      hasMore: offset + data.length < total,
      totalIn: totalInNum.toFixed(2),
      totalOut: totalOutNum.toFixed(2),
      net: (totalInNum - totalOutNum).toFixed(2),
      totalBet: totalBetNum.toFixed(2),
      totalWon: totalWonNum.toFixed(2),
      netGaming: (totalBetNum - totalWonNum).toFixed(2),
    };
  }

  /**
   * Agregados para un bucket de fechas. Devuelve totales in/out/net,
   * count por type, y amount por type.
   */
  async summary(
    db: TenantDb,
    filters: Pick<ListMovementsFilters, 'dateFrom' | 'dateTo' | 'restrictToUserIds'>,
  ): Promise<SummaryBucket> {
    const { dateFrom, dateTo } = this.resolveDateRange(filters);
    const where = this.buildWhere({
      dateFrom,
      dateTo,
      restrictToUserIds: filters.restrictToUserIds,
    });

    const rows = await db
      .select({
        type: walletTransactions.type,
        count: sql<number>`COUNT(*)::int`,
        sumAmount: sql<string>`COALESCE(SUM(${walletTransactions.amount})::text, '0')`,
      })
      .from(walletTransactions)
      .innerJoin(wallets, eq(walletTransactions.walletId, wallets.id))
      .where(where)
      .groupBy(walletTransactions.type);

    let totalIn = 0;
    let totalOut = 0;
    let txCount = 0;
    const countByType: Record<string, number> = {};
    const amountByType: Record<string, string> = {};

    for (const r of rows) {
      const type = r.type;
      const amount = Number(r.sumAmount);
      countByType[type] = r.count;
      amountByType[type] = r.sumAmount;
      txCount += r.count;
      if (INFLOW_TYPES.includes(type)) totalIn += amount;
      else if (OUTFLOW_TYPES.includes(type)) totalOut += amount;
      // 'adjustment' y 'rollback' no se cuentan en in/out — son neutros
      // a nivel agregado (cada caso individual depende del context).
    }

    return {
      bucket: this.classifyBucket(dateFrom, dateTo),
      dateFrom,
      dateTo,
      totalIn: totalIn.toFixed(2),
      totalOut: totalOut.toFixed(2),
      net: (totalIn - totalOut).toFixed(2),
      txCount,
      countByType,
      amountByType,
    };
  }

  /**
   * Breakdown por rol del owner del wallet. Útil para responder
   * "¿cuánta plata flota hacia/desde cada nivel de la pirámide?".
   */
  async byRole(
    db: TenantDb,
    filters: Pick<ListMovementsFilters, 'dateFrom' | 'dateTo' | 'restrictToUserIds'>,
  ): Promise<ByRoleRow[]> {
    const { dateFrom, dateTo } = this.resolveDateRange(filters);
    const where = this.buildWhere({
      dateFrom,
      dateTo,
      restrictToUserIds: filters.restrictToUserIds,
    });

    // Subquery del rol primario por user (mismo criterio que en listMovements).
    const primaryRole = sql<string>`COALESCE((
      SELECT r.code FROM ${userRoles} ur
      INNER JOIN ${roles} r ON r.id = ur.role_id
      WHERE ur.user_id = ${wallets.userId}
      ORDER BY CASE WHEN r.code = 'usuario_final' THEN 1 ELSE 0 END, r.code
      LIMIT 1
    ), 'sin_rol')`;

    const rows = await db
      .select({
        role: primaryRole.as('role'),
        type: walletTransactions.type,
        sumAmount: sql<string>`COALESCE(SUM(${walletTransactions.amount})::text, '0')`,
        txCount: sql<number>`COUNT(*)::int`,
        uniqueUsers: sql<number>`COUNT(DISTINCT ${wallets.userId})::int`,
      })
      .from(walletTransactions)
      .innerJoin(wallets, eq(walletTransactions.walletId, wallets.id))
      .where(where)
      .groupBy(primaryRole, walletTransactions.type);

    // Reduce manual para in/out por rol.
    const acc = new Map<
      string,
      { inflow: number; outflow: number; txCount: number; userIds: Set<string> }
    >();
    // Para uniqueUsers correcto, necesitamos otra query (el COUNT DISTINCT
    // por grupo ya lo da pero por type, no global). Hacemos sum simple por rol.
    for (const r of rows) {
      const cur = acc.get(r.role) ?? {
        inflow: 0,
        outflow: 0,
        txCount: 0,
        userIds: new Set(),
      };
      const amount = Number(r.sumAmount);
      if (INFLOW_TYPES.includes(r.type)) cur.inflow += amount;
      else if (OUTFLOW_TYPES.includes(r.type)) cur.outflow += amount;
      cur.txCount += r.txCount;
      acc.set(r.role, cur);
    }

    // uniqueUsers reales por rol (separado, sin GROUP BY por type).
    const uniqueRows = await db
      .select({
        role: primaryRole.as('role'),
        uniqueUsers: sql<number>`COUNT(DISTINCT ${wallets.userId})::int`,
      })
      .from(walletTransactions)
      .innerJoin(wallets, eq(walletTransactions.walletId, wallets.id))
      .where(where)
      .groupBy(primaryRole);
    const uniqueByRole = new Map(uniqueRows.map((r) => [r.role, r.uniqueUsers]));

    return Array.from(acc.entries())
      .map(([role, v]) => ({
        role,
        inflow: v.inflow.toFixed(2),
        outflow: v.outflow.toFixed(2),
        net: (v.inflow - v.outflow).toFixed(2),
        txCount: v.txCount,
        uniqueUsers: uniqueByRole.get(role) ?? 0,
      }))
      .sort((a, b) => Math.abs(Number(b.net)) - Math.abs(Number(a.net)));
  }

  /**
   * Igual que listMovements pero sin paginación — devuelve hasta MAX_LIMIT
   * rows para export CSV. Si la suma supera, el caller debe paginar manual.
   */
  async listForExport(
    db: TenantDb,
    filters: ListMovementsFilters,
    maxRows: number,
  ): Promise<MovementRow[]> {
    const page = await this.listMovements(db, { ...filters, limit: maxRows, offset: 0 }, maxRows);
    return page.data;
  }

  // ── Auditoría por ámbito (netwin por red) ────────────────────────────

  /**
   * Netwin (GGR) de un ámbito, desde `game_rounds` — MISMA fuente que el
   * módulo de comisiones (C4b), para que los números reconcilien con
   * "Mi sucursal": apostado = Σ bet_amount, ganado = Σ win_amount, sobre las
   * rondas `settled` de la ventana (por `settled_at`), de los jugadores del
   * ámbito. `bet_amount` ya incluye las apuestas fondeadas con bono.
   *
   * Nota de reconciliación: comisiones además EXCLUYE el auto-juego de un
   * operador y las sub-ramas independientes anidadas de la base de ESE
   * operador; acá sumamos todas las rondas de los usuarios del ámbito
   * (para un socio independiente puntual eso es su red completa).
   */
  async netwinFor(
    db: TenantDb,
    filters: ScopedAuditFilters,
  ): Promise<NetwinResult> {
    const conds = [eq(gameRounds.status, 'settled')];
    if (filters.dateFrom) conds.push(gte(gameRounds.settledAt, filters.dateFrom));
    if (filters.dateTo) conds.push(lte(gameRounds.settledAt, filters.dateTo));
    if (filters.restrictToUserIds?.length) {
      conds.push(inArray(gameRounds.userId, filters.restrictToUserIds));
    }
    const rows = await db
      .select({
        bet: sql<string>`COALESCE(SUM(${gameRounds.betAmount})::text, '0')`,
        win: sql<string>`COALESCE(SUM(${gameRounds.winAmount})::text, '0')`,
      })
      .from(gameRounds)
      .where(and(...conds));

    const apostado = Number(rows[0]?.bet ?? '0');
    const ganado = Number(rows[0]?.win ?? '0');
    return {
      apostado: apostado.toFixed(2),
      ganado: ganado.toFixed(2),
      netwin: (apostado - ganado).toFixed(2),
      rtp: apostado > 0 ? (ganado / apostado).toFixed(4) : null,
    };
  }

  /**
   * Auditoría agregada de un ámbito: juego (netwin), plata minorista
   * (depósitos/retiros de jugadores), fichas mayorista (cargas/descargas a
   * operadores), bonos y circulación. Una sola query agrupada por (type,
   * owner es operador) + una query de circulación (snapshot de balances).
   */
  async scopedAudit(
    db: TenantDb,
    filters: ScopedAuditFilters,
  ): Promise<ScopedAudit> {
    const AUDIT_TYPES: WalletTxType[] = [
      'deposit', 'withdrawal',
      'load', 'unload',
    ];
    const where = this.buildWhere({
      types: AUDIT_TYPES,
      dateFrom: filters.dateFrom,
      dateTo: filters.dateTo,
      restrictToUserIds: filters.restrictToUserIds,
    });

    // El owner del wallet ¿es operador? (tiene algún rol != usuario_final).
    const ownerIsOperator = sql`EXISTS (
      SELECT 1 FROM ${userRoles} ur
      INNER JOIN ${roles} r ON r.id = ur.role_id
      WHERE ur.user_id = ${wallets.userId} AND r.code <> 'usuario_final'
    )`;

    const rows = await db
      .select({
        type: walletTransactions.type,
        isOperator: sql<boolean>`${ownerIsOperator}`.as('is_operator'),
        sum: sql<string>`COALESCE(SUM(${walletTransactions.amount})::text, '0')`,
      })
      .from(walletTransactions)
      .innerJoin(wallets, eq(walletTransactions.walletId, wallets.id))
      .where(where)
      .groupBy(walletTransactions.type, ownerIsOperator);

    // Suma por type, opcionalmente filtrando por owner operador/jugador.
    const pick = (type: string, oper?: boolean): number =>
      rows
        .filter(
          (r) =>
            r.type === type &&
            (oper === undefined || Boolean(r.isOperator) === oper),
        )
        .reduce((acc, r) => acc + Number(r.sum), 0);

    const depositos = pick('deposit');
    const retiros = pick('withdrawal');
    const cargasOperadores = pick('load', true);
    const descargasOperadores = pick('unload', true);
    const cargasJugadores = pick('load', false);

    // Netwin desde game_rounds (misma fuente que comisiones, C4b) y bonos desde
    // user_bonuses — porque los types de wallet (bonus_grant/clear/forfeit) NO
    // se crean en el flujo real (otorgar crea bonus_credit; expirar,
    // bonus_funding_revert). El resto (plata/fichas) sí sale del ledger.
    const juego = await this.netwinFor(db, filters);
    const bonos = await this.bonusesFor(db, filters);
    const circulacion = await this.circulationFor(db, filters.restrictToUserIds);

    return {
      dateFrom: filters.dateFrom ?? null,
      dateTo: filters.dateTo ?? null,
      juego,
      plata: {
        depositos: depositos.toFixed(2),
        retiros: retiros.toFixed(2),
        neto: (depositos - retiros).toFixed(2),
      },
      fichas: {
        cargasOperadores: cargasOperadores.toFixed(2),
        descargasOperadores: descargasOperadores.toFixed(2),
        neto: (cargasOperadores - descargasOperadores).toFixed(2),
        cargasJugadores: cargasJugadores.toFixed(2),
      },
      bonos,
      circulacion,
    };
  }

  /**
   * Fichas en circulación del ámbito = Σ balance de los JUGADORES (rol
   * `usuario_final` y ningún rol de operador) cuyo owner ∈ `restrictToUserIds`.
   * Snapshot (sin fecha). Excluye operadores (inventario) y la Casa (tesorería).
   */
  private async circulationFor(
    db: TenantDb,
    restrictToUserIds?: string[],
  ): Promise<string> {
    const conds = [
      sql`EXISTS (
        SELECT 1 FROM ${userRoles} ur
        INNER JOIN ${roles} r ON r.id = ur.role_id
        WHERE ur.user_id = ${wallets.userId} AND r.code = 'usuario_final'
      )`,
      sql`NOT EXISTS (
        SELECT 1 FROM ${userRoles} ur
        INNER JOIN ${roles} r ON r.id = ur.role_id
        WHERE ur.user_id = ${wallets.userId} AND r.code <> 'usuario_final'
      )`,
    ];
    if (restrictToUserIds?.length) {
      conds.push(inArray(wallets.userId, restrictToUserIds));
    }
    const rows = await db
      .select({
        sum: sql<string>`COALESCE(SUM(${wallets.balance})::text, '0')`,
      })
      .from(wallets)
      .where(and(...conds));
    return Number(rows[0]?.sum ?? '0').toFixed(2);
  }

  /**
   * Bonos del ámbito desde `user_bonuses` (fuente autoritativa):
   *   - otorgados = Σ granted_amount, por `granted_at`.
   *   - liberados = Σ remaining_amount de los `cleared` (pasados a fichas
   *     reales), por `cleared_at`.
   *   - perdidos  = Σ remaining_amount de los `expired`/`forfeited` (el jugador
   *     los perdió; `cancelled` NO cuenta, ahí el fondeo vuelve al que fondeó),
   *     por `updated_at`.
   * Bono es solo de jugadores (R8); scope por `user_id`.
   */
  private async bonusesFor(
    db: TenantDb,
    filters: ScopedAuditFilters,
  ): Promise<{ otorgados: string; liberados: string; perdidos: string }> {
    const scope = filters.restrictToUserIds;
    const scopeCond: SQL | undefined = scope?.length
      ? inArray(userBonuses.userId, scope)
      : undefined;

    const otorgados = await this.sumUserBonuses(
      db,
      userBonuses.grantedAmount,
      userBonuses.grantedAt,
      filters,
      scopeCond,
    );
    const liberados = await this.sumUserBonuses(
      db,
      userBonuses.remainingAmount,
      userBonuses.clearedAt,
      filters,
      scopeCond,
      eq(userBonuses.status, 'cleared'),
    );
    const perdidos = await this.sumUserBonuses(
      db,
      userBonuses.remainingAmount,
      userBonuses.updatedAt,
      filters,
      scopeCond,
      inArray(userBonuses.status, ['expired', 'forfeited']),
    );
    return { otorgados, liberados, perdidos };
  }

  /** Helper: Σ de una columna de `user_bonuses` con filtro de fecha por la
   * columna temporal indicada + scope + condición extra opcional. */
  private async sumUserBonuses(
    db: TenantDb,
    amountCol: AnyColumn,
    dateCol: AnyColumn,
    filters: ScopedAuditFilters,
    scopeCond?: SQL,
    extraCond?: SQL,
  ): Promise<string> {
    const conds: SQL[] = [];
    if (extraCond) conds.push(extraCond);
    if (scopeCond) conds.push(scopeCond);
    if (filters.dateFrom) conds.push(gte(dateCol, filters.dateFrom));
    if (filters.dateTo) conds.push(lte(dateCol, filters.dateTo));
    const rows = await db
      .select({ sum: sql<string>`COALESCE(SUM(${amountCol})::text, '0')` })
      .from(userBonuses)
      .where(conds.length ? and(...conds) : undefined);
    return Number(rows[0]?.sum ?? '0').toFixed(2);
  }

  /** Socios independientes (rol `socio` + `is_independent_branch=true`). */
  async listIndependentSocios(db: TenantDb): Promise<IndependentSocio[]> {
    return db
      .selectDistinct({
        id: users.id,
        username: users.username,
        displayName: users.displayName,
      })
      .from(users)
      .innerJoin(userRoles, eq(userRoles.userId, users.id))
      .innerJoin(roles, eq(roles.id, userRoles.roleId))
      .where(
        and(eq(roles.code, 'socio'), eq(users.isIndependentBranch, true)),
      );
  }

  // ── Helpers internos ───────────────────────────────────────────────

  private buildWhere(filters: ListMovementsFilters) {
    const conds = [];

    if (filters.types?.length) {
      conds.push(inArray(walletTransactions.type, filters.types));
    }
    if (filters.dateFrom) conds.push(gte(walletTransactions.createdAt, filters.dateFrom));
    if (filters.dateTo) conds.push(lte(walletTransactions.createdAt, filters.dateTo));
    if (filters.userId) conds.push(eq(wallets.userId, filters.userId));
    if (filters.actorId) conds.push(eq(walletTransactions.createdBy, filters.actorId));
    if (filters.minAmount !== undefined) {
      conds.push(gte(walletTransactions.amount, String(filters.minAmount)));
    }
    if (filters.maxAmount !== undefined) {
      conds.push(lte(walletTransactions.amount, String(filters.maxAmount)));
    }
    if (filters.restrictToUserIds?.length) {
      conds.push(inArray(wallets.userId, filters.restrictToUserIds));
    }

    return conds.length > 0 ? and(...conds) : undefined;
  }

  private directionOf(type: WalletTxType): 'in' | 'out' {
    return INFLOW_TYPES.includes(type) ? 'in' : 'out';
  }

  private resolveDateRange(filters: {
    dateFrom?: Date;
    dateTo?: Date;
  }): { dateFrom: Date; dateTo: Date } {
    const now = new Date();
    const dateTo = filters.dateTo ?? now;
    // Default a 30d si no se pasa from.
    const dateFrom =
      filters.dateFrom ??
      new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    return { dateFrom, dateTo };
  }

  private classifyBucket(dateFrom: Date, dateTo: Date): BucketKey {
    const diffDays = Math.round(
      (dateTo.getTime() - dateFrom.getTime()) / (1000 * 60 * 60 * 24),
    );
    if (diffDays <= 1) return 'today';
    if (diffDays <= 7) return '7d';
    if (diffDays <= 30) return '30d';
    return 'custom';
  }
}
