/**
 * GameStatsService — agregados sobre `game_rounds` (Sprint 46).
 *
 * Read-only puro. Métricas clave:
 *   - GGR (Gross Gaming Revenue) = totalBet - totalWin. Es la ganancia
 *     bruta del casino para el período.
 *   - RTP real = totalWin / totalBet. Comparar contra config.rtp del game
 *     define si el juego está "calibrado" (divergencia >5% = alerta).
 *   - Top losers/winners por user.
 *   - Volumen y rondas por juego.
 *
 * Excluye rounds `rolled_back` de TODOS los agregados — no son apuestas
 * efectivas (el bet se refundió, no afecta GGR ni RTP real).
 */

import { Injectable } from '@nestjs/common';
import { and, asc, eq, gte, inArray, lte, ne, sql } from 'drizzle-orm';
import { gameRounds, games, users, walletTransactions } from '@casino/db';
import type { TenantDb } from '../tenant-resolver/tenant-context';

export type RoundStatus = 'placed' | 'settled' | 'rolled_back';

export interface ListRoundsFilters {
  gameCode?: string;
  userId?: string;
  sessionId?: string;
  status?: RoundStatus;
  dateFrom?: Date;
  dateTo?: Date;
  minBet?: number;
  maxBet?: number;
  /** 'win' | 'loss' | 'zero' — derivado de net_amount. */
  outcome?: 'win' | 'loss' | 'zero';
  limit?: number;
  offset?: number;
  /** Si se pasa, restringe a estos userIds (scope). */
  restrictToUserIds?: string[];
}

export interface RoundRow {
  id: string;
  sessionId: string;
  gameCode: string;
  gameName: string;
  providerCode: string;
  userId: string;
  username: string;
  displayName: string;
  status: RoundStatus;
  betAmount: string;
  winAmount: string;
  netAmount: string;
  roundExternalId: string;
  /** Balance del jugador después de la apuesta (post-bet). */
  balanceAfter: string | null;
  placedAt: Date;
  settledAt: Date | null;
  rolledBackAt: Date | null;
  outcome: 'win' | 'loss' | 'zero';
}

export interface RoundsPage {
  data: RoundRow[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

export type BucketKey = 'today' | '7d' | '30d' | 'custom';

export interface GameStatsSummary {
  bucket: BucketKey;
  dateFrom: Date;
  dateTo: Date;
  totalBet: string;
  totalWin: string;
  ggr: string;
  /** RTP real como porcentaje 0-100 (no fracción). */
  rtpRealPct: string;
  roundsCount: number;
  uniquePlayers: number;
  /** Rounds que terminaron rolled_back — diagnostic, NO entran en agregados. */
  rolledBackCount: number;
}

export interface ReconciliationBucket {
  count: number;
  bet: string;
  win: string;
}

/** Diagnóstico de reconciliación con Estadísticas de pago — ver `getReconciliation`. */
export interface GameStatsReconciliation {
  dateFrom: string;
  dateTo: string;
  byPlacedAt: {
    settled: ReconciliationBucket;
    inFlight: ReconciliationBucket;
  };
  bySettledAt: {
    settled: ReconciliationBucket;
  };
  /** Antigüedad (hs) de la ronda 'placed' más vieja que existe HOY, sin filtro de fecha/scope. */
  oldestInFlightAgeHours: number | null;
}

export interface ByGameRow {
  gameId: string;
  gameCode: string;
  gameName: string;
  /** RTP target del config (puede ser null si no está set). */
  rtpTargetPct: number | null;
  totalBet: string;
  totalWin: string;
  ggr: string;
  /** RTP real como porcentaje. */
  rtpRealPct: string;
  /** Divergencia |real - target| en puntos. NULL si target no definido. */
  rtpDivergencePts: string | null;
  /** true si divergencia > 5 puntos — flag de "atención al juego". */
  flagged: boolean;
  roundsCount: number;
  uniquePlayers: number;
}

export interface ByPlayerRow {
  userId: string;
  username: string;
  displayName: string;
  totalBet: string;
  totalWin: string;
  /** Net del player — negativo = pérdida para él = ganancia para el casino. */
  netAmount: string;
  roundsCount: number;
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
/** Umbral de divergencia RTP en puntos para flagear un juego. */
const RTP_DIVERGENCE_FLAG_PTS = 5;

@Injectable()
export class GameStatsService {
  /**
   * Lista paginada de rounds con enrichment (game + user joined).
   */
  async listRounds(
    db: TenantDb,
    filters: ListRoundsFilters,
  ): Promise<RoundsPage> {
    const limit = Math.min(filters.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
    const offset = Math.max(filters.offset ?? 0, 0);

    const where = this.buildWhere(filters);

    const totalRow = await db
      .select({ count: sql<number>`COUNT(*)::int` })
      .from(gameRounds)
      .innerJoin(games, eq(gameRounds.gameId, games.id))
      .innerJoin(users, eq(gameRounds.userId, users.id))
      .where(where);
    const total = totalRow[0]?.count ?? 0;

    const rows = await db
      .select({
        id: gameRounds.id,
        sessionId: gameRounds.sessionId,
        gameCode: games.code,
        gameName: games.name,
        providerCode: games.providerCode,
        userId: gameRounds.userId,
        username: users.username,
        displayName: users.displayName,
        status: gameRounds.status,
        betAmount: gameRounds.betAmount,
        winAmount: gameRounds.winAmount,
        netAmount: gameRounds.netAmount,
        roundExternalId: gameRounds.roundExternalId,
        balanceAfter: walletTransactions.balanceAfter,
        placedAt: gameRounds.placedAt,
        settledAt: gameRounds.settledAt,
        rolledBackAt: gameRounds.rolledBackAt,
      })
      .from(gameRounds)
      .innerJoin(games, eq(gameRounds.gameId, games.id))
      .innerJoin(users, eq(gameRounds.userId, users.id))
      .leftJoin(
        walletTransactions,
        eq(gameRounds.betWalletTxId, walletTransactions.id),
      )
      .where(where)
      .orderBy(sql`${gameRounds.placedAt} DESC`)
      .limit(limit)
      .offset(offset);

    const data = rows.map(
      (r): RoundRow => ({
        ...r,
        status: r.status,
        outcome: this.outcomeOf(r.netAmount),
      }),
    );

    return {
      data,
      total,
      limit,
      offset,
      hasMore: offset + data.length < total,
    };
  }

  /**
   * Agregados globales: GGR, RTP real, rounds, players únicos.
   * Excluye rolled_back de los totales (reportados aparte como diagnostic).
   */
  async summary(
    db: TenantDb,
    filters: Pick<ListRoundsFilters, 'dateFrom' | 'dateTo' | 'restrictToUserIds'>,
  ): Promise<GameStatsSummary> {
    const { dateFrom, dateTo } = this.resolveDateRange(filters);

    // Agregado de los rounds efectivos (no rolled_back).
    const where = and(
      gte(gameRounds.placedAt, dateFrom),
      lte(gameRounds.placedAt, dateTo),
      ne(gameRounds.status, 'rolled_back'),
      filters.restrictToUserIds?.length
        ? inArray(gameRounds.userId, filters.restrictToUserIds)
        : undefined,
    );

    const agg = await db
      .select({
        totalBet: sql<string>`COALESCE(SUM(${gameRounds.betAmount})::text, '0')`,
        totalWin: sql<string>`COALESCE(SUM(${gameRounds.winAmount})::text, '0')`,
        rounds: sql<number>`COUNT(*)::int`,
        players: sql<number>`COUNT(DISTINCT ${gameRounds.userId})::int`,
      })
      .from(gameRounds)
      .where(where);

    // Diagnostic de rolled_back para la misma ventana.
    const rolledRow = await db
      .select({ rolled: sql<number>`COUNT(*)::int` })
      .from(gameRounds)
      .where(
        and(
          gte(gameRounds.placedAt, dateFrom),
          lte(gameRounds.placedAt, dateTo),
          eq(gameRounds.status, 'rolled_back'),
          filters.restrictToUserIds?.length
            ? inArray(gameRounds.userId, filters.restrictToUserIds)
            : undefined,
        ),
      );

    const totalBet = Number(agg[0]?.totalBet ?? 0);
    const totalWin = Number(agg[0]?.totalWin ?? 0);
    const ggr = totalBet - totalWin;
    const rtpReal = totalBet > 0 ? (totalWin / totalBet) * 100 : 0;

    return {
      bucket: this.classifyBucket(dateFrom, dateTo),
      dateFrom,
      dateTo,
      totalBet: totalBet.toFixed(2),
      totalWin: totalWin.toFixed(2),
      ggr: ggr.toFixed(2),
      rtpRealPct: rtpReal.toFixed(2),
      roundsCount: agg[0]?.rounds ?? 0,
      uniquePlayers: agg[0]?.players ?? 0,
      rolledBackCount: rolledRow[0]?.rolled ?? 0,
    };
  }

  /**
   * Diagnóstico de reconciliación — explica POR QUÉ el netwin de esta página
   * puede no coincidir con Estadísticas de pago / Comisiones / el Resumen
   * financiero (2026-08, pedido de Uriel al ver una diferencia grande).
   *
   * `summary()` de esta página cuenta por `placedAt` e incluye rondas
   * `placed` (en curso, sin liquidar). Pago/Comisiones cuentan por
   * `settledAt` y SOLO `status='settled'`. Esto separa esa diferencia en
   * partes explicables:
   *   - `byPlacedAt.settled`  = la parte de esta página que YA liquidó.
   *   - `byPlacedAt.inFlight` = la parte de esta página que sigue en curso
   *     (`status='placed'`) — normal si son recientes; sospechoso si son
   *     viejas (ver `oldestInFlightAgeHours`).
   *   - `bySettledAt.settled` = el número que muestran Pago/Comisiones para
   *     la MISMA ventana de fechas (debería matchear exacto con esas
   *     páginas si el rango es igual).
   *
   * La diferencia entre `bySettledAt.settled` y `byPlacedAt.settled` es
   * volumen que "cruza" la ventana: rondas liquidadas en el rango pero
   * apostadas antes (o viceversa) — normal cerca de los bordes del rango,
   * pero no debería ser grande si el rango es de varios días.
   */
  async getReconciliation(
    db: TenantDb,
    filters: Pick<ListRoundsFilters, 'dateFrom' | 'dateTo' | 'restrictToUserIds'>,
  ): Promise<GameStatsReconciliation> {
    const { dateFrom, dateTo } = this.resolveDateRange(filters);
    const scopeCond = filters.restrictToUserIds?.length
      ? inArray(gameRounds.userId, filters.restrictToUserIds)
      : undefined;

    const bucket = async (
      dateCol: typeof gameRounds.placedAt | typeof gameRounds.settledAt,
      status: 'settled' | 'placed',
    ): Promise<ReconciliationBucket> => {
      const rows = await db
        .select({
          count: sql<number>`COUNT(*)::int`,
          bet: sql<string>`COALESCE(SUM(${gameRounds.betAmount})::text, '0')`,
          win: sql<string>`COALESCE(SUM(${gameRounds.winAmount})::text, '0')`,
        })
        .from(gameRounds)
        .where(and(gte(dateCol, dateFrom), lte(dateCol, dateTo), eq(gameRounds.status, status), scopeCond));
      return {
        count: rows[0]?.count ?? 0,
        bet: rows[0]?.bet ?? '0',
        win: rows[0]?.win ?? '0',
      };
    };

    const [settledByPlacedAt, inFlight, settledBySettledAt] = await Promise.all([
      bucket(gameRounds.placedAt, 'settled'),
      bucket(gameRounds.placedAt, 'placed'),
      bucket(gameRounds.settledAt, 'settled'),
    ]);

    // Antigüedad de la ronda 'placed' más vieja que existe HOY (sin filtro de
    // fecha ni scope — es un chequeo global de salud, no del ámbito elegido).
    // Si esto da varios días/semanas, hay rondas trabadas sin liquidar.
    const oldestRow = await db
      .select({ placedAt: gameRounds.placedAt })
      .from(gameRounds)
      .where(eq(gameRounds.status, 'placed'))
      .orderBy(asc(gameRounds.placedAt))
      .limit(1);
    const oldest = oldestRow[0]?.placedAt ?? null;
    const oldestInFlightAgeHours = oldest
      ? Math.round(((Date.now() - oldest.getTime()) / 3_600_000) * 10) / 10
      : null;

    return {
      dateFrom: dateFrom.toISOString(),
      dateTo: dateTo.toISOString(),
      byPlacedAt: { settled: settledByPlacedAt, inFlight },
      bySettledAt: { settled: settledBySettledAt },
      oldestInFlightAgeHours,
    };
  }

  /**
   * Breakdown por game: cada juego con su GGR, RTP real, divergencia
   * vs RTP target del config. Flag si divergencia > 5 puntos.
   */
  async byGame(
    db: TenantDb,
    filters: Pick<ListRoundsFilters, 'dateFrom' | 'dateTo' | 'restrictToUserIds'>,
  ): Promise<ByGameRow[]> {
    const { dateFrom, dateTo } = this.resolveDateRange(filters);
    const where = and(
      gte(gameRounds.placedAt, dateFrom),
      lte(gameRounds.placedAt, dateTo),
      ne(gameRounds.status, 'rolled_back'),
      filters.restrictToUserIds?.length
        ? inArray(gameRounds.userId, filters.restrictToUserIds)
        : undefined,
    );

    const rows = await db
      .select({
        gameId: games.id,
        gameCode: games.code,
        gameName: games.name,
        gameConfig: games.config,
        totalBet: sql<string>`COALESCE(SUM(${gameRounds.betAmount})::text, '0')`,
        totalWin: sql<string>`COALESCE(SUM(${gameRounds.winAmount})::text, '0')`,
        rounds: sql<number>`COUNT(*)::int`,
        players: sql<number>`COUNT(DISTINCT ${gameRounds.userId})::int`,
      })
      .from(gameRounds)
      .innerJoin(games, eq(gameRounds.gameId, games.id))
      .where(where)
      .groupBy(games.id, games.code, games.name, games.config);

    return rows
      .map((r): ByGameRow => {
        const totalBet = Number(r.totalBet);
        const totalWin = Number(r.totalWin);
        const ggr = totalBet - totalWin;
        const rtpReal = totalBet > 0 ? (totalWin / totalBet) * 100 : 0;

        // El RTP target vive en config.rtp como fracción 0-1 (e.g. 0.96).
        // Convertimos a porcentaje 0-100 para comparar.
        const config = r.gameConfig as Record<string, unknown> | null;
        const rtpTargetRaw = config?.rtp;
        const rtpTargetPct =
          typeof rtpTargetRaw === 'number'
            ? rtpTargetRaw <= 1
              ? rtpTargetRaw * 100
              : rtpTargetRaw
            : null;

        const divergence =
          rtpTargetPct !== null && totalBet > 0
            ? Math.abs(rtpReal - rtpTargetPct)
            : null;

        return {
          gameId: r.gameId,
          gameCode: r.gameCode,
          gameName: r.gameName,
          rtpTargetPct,
          totalBet: totalBet.toFixed(2),
          totalWin: totalWin.toFixed(2),
          ggr: ggr.toFixed(2),
          rtpRealPct: rtpReal.toFixed(2),
          rtpDivergencePts: divergence !== null ? divergence.toFixed(2) : null,
          flagged: divergence !== null && divergence > RTP_DIVERGENCE_FLAG_PTS,
          roundsCount: r.rounds,
          uniquePlayers: r.players,
        };
      })
      .sort((a, b) => Number(b.totalBet) - Number(a.totalBet));
  }

  /**
   * Top players por volumen apostado. Por default top 50, ajustable
   * via limit. Net negativo = el casino ganó (player perdió).
   */
  async byPlayer(
    db: TenantDb,
    filters: Pick<ListRoundsFilters, 'dateFrom' | 'dateTo' | 'restrictToUserIds' | 'limit'>,
  ): Promise<ByPlayerRow[]> {
    const { dateFrom, dateTo } = this.resolveDateRange(filters);
    const limit = Math.min(filters.limit ?? DEFAULT_LIMIT, MAX_LIMIT);

    const where = and(
      gte(gameRounds.placedAt, dateFrom),
      lte(gameRounds.placedAt, dateTo),
      ne(gameRounds.status, 'rolled_back'),
      filters.restrictToUserIds?.length
        ? inArray(gameRounds.userId, filters.restrictToUserIds)
        : undefined,
    );

    const rows = await db
      .select({
        userId: gameRounds.userId,
        username: users.username,
        displayName: users.displayName,
        totalBet: sql<string>`COALESCE(SUM(${gameRounds.betAmount})::text, '0')`,
        totalWin: sql<string>`COALESCE(SUM(${gameRounds.winAmount})::text, '0')`,
        rounds: sql<number>`COUNT(*)::int`,
      })
      .from(gameRounds)
      .innerJoin(users, eq(gameRounds.userId, users.id))
      .where(where)
      .groupBy(gameRounds.userId, users.username, users.displayName)
      .orderBy(sql`SUM(${gameRounds.betAmount}) DESC NULLS LAST`)
      .limit(limit);

    return rows.map((r): ByPlayerRow => {
      const totalBet = Number(r.totalBet);
      const totalWin = Number(r.totalWin);
      // net_player = win - bet (positivo si el player ganó plata).
      const net = totalWin - totalBet;
      return {
        userId: r.userId,
        username: r.username,
        displayName: r.displayName,
        totalBet: totalBet.toFixed(2),
        totalWin: totalWin.toFixed(2),
        netAmount: net.toFixed(2),
        roundsCount: r.rounds,
      };
    });
  }

  async listForExport(
    db: TenantDb,
    filters: ListRoundsFilters,
    maxRows: number,
  ): Promise<RoundRow[]> {
    const page = await this.listRounds(db, { ...filters, limit: maxRows, offset: 0 });
    return page.data;
  }

  // ── Helpers ────────────────────────────────────────────────────────

  private buildWhere(filters: ListRoundsFilters) {
    const conds = [];
    if (filters.gameCode) conds.push(eq(games.code, filters.gameCode));
    if (filters.userId) conds.push(eq(gameRounds.userId, filters.userId));
    if (filters.sessionId) conds.push(eq(gameRounds.sessionId, filters.sessionId));
    if (filters.status) conds.push(eq(gameRounds.status, filters.status));
    if (filters.dateFrom) conds.push(gte(gameRounds.placedAt, filters.dateFrom));
    if (filters.dateTo) conds.push(lte(gameRounds.placedAt, filters.dateTo));
    if (filters.minBet !== undefined) {
      conds.push(gte(gameRounds.betAmount, String(filters.minBet)));
    }
    if (filters.maxBet !== undefined) {
      conds.push(lte(gameRounds.betAmount, String(filters.maxBet)));
    }
    if (filters.outcome) {
      if (filters.outcome === 'win') conds.push(sql`${gameRounds.netAmount} > 0`);
      else if (filters.outcome === 'loss') conds.push(sql`${gameRounds.netAmount} < 0`);
      else conds.push(sql`${gameRounds.netAmount} = 0`);
    }
    if (filters.restrictToUserIds?.length) {
      conds.push(inArray(gameRounds.userId, filters.restrictToUserIds));
    }
    return conds.length > 0 ? and(...conds) : undefined;
  }

  private outcomeOf(netAmount: string): 'win' | 'loss' | 'zero' {
    const n = Number(netAmount);
    if (n > 0) return 'win';
    if (n < 0) return 'loss';
    return 'zero';
  }

  private resolveDateRange(filters: {
    dateFrom?: Date;
    dateTo?: Date;
  }): { dateFrom: Date; dateTo: Date } {
    const now = new Date();
    const dateTo = filters.dateTo ?? now;
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
