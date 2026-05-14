/**
 * LeaguesService — CRUD + recompute standings + close & settle.
 *
 * Métricas MVP soportadas:
 *   - `bet_volume`: SUM(amount) WHERE type='bet'.
 *   - `rounds_count`: COUNT(*) WHERE type='bet'. Cada bet = 1 round.
 *
 * Pendientes (fuera de scope sprint):
 *   - `gross_won`: SUM(amount) WHERE type='win'.
 *   - `player_netwin`: SUM(win) - SUM(bet).
 *   - `score_custom`: parser de fórmula.
 *
 * Recompute:
 *   - Toma la métrica, calcula score por user con activity en
 *     [startsAt, endsAt). DELETE FROM league_standings + INSERT batch
 *     con position calculada.
 *   - Operación O(N users con activity) — para volúmenes MVP (<1k users
 *     activos por league) es <100ms. Para volúmenes mayores: índice GIN
 *     sobre wallet_transactions.created_at + paginar.
 *
 * Close & settle:
 *   - Re-recompute final.
 *   - Por cada posición premiada en `league.prizes`, otorgar via
 *     `PromotionPrizeAwarder.award` con context = league.
 *   - Insert league_results.
 *   - Status → 'closed'.
 *   - Idempotent: re-run no duplica (key `settle:<userId>` UNIQUE
 *     intra-league).
 *
 * Soporta keys de prizes:
 *   - "1", "2", "3", ... (posición exacta).
 *   - "2-5", "6-10", "11-50" (rango inclusive).
 */

import { Injectable, Logger } from '@nestjs/common';
import { and, asc, desc, eq, gte, lt, sql } from 'drizzle-orm';
import {
  leagueResults,
  leagueStandings,
  leagues,
  wallets,
  walletTransactions,
  type League,
  type LeagueStanding,
  type NewLeague,
  type NewLeagueResult,
  type NewLeagueStanding,
} from '@casino/db';
import type { TenantDb } from '../tenant-resolver/tenant-context';
import {
  PromotionPrizeAwarder,
  type PromotionPrize,
} from '../promotions/prize-awarder.service';
import {
  LeagueCodeConflictError,
  LeagueMetricNotSupportedError,
  LeagueNotClosableError,
  LeagueNotFoundError,
  LeagueScheduleInvalidError,
} from './leagues.errors';
import type {
  CreateLeagueDto,
  UpdateLeagueDto,
} from './dto/league.dto';

const SUPPORTED_METRICS: ReadonlyArray<League['metric']> = [
  'bet_volume',
  'rounds_count',
];

interface PrizeMapEntry {
  positions: number[]; // posiciones que matchean esta entry
  prize: PromotionPrize;
}

export interface CloseResult {
  leagueId: string;
  leagueCode: string;
  totalParticipants: number;
  totalSettled: number;
  totalSkipped: number;
  totalFailed: number;
  failedUserIds: string[];
}

@Injectable()
export class LeaguesService {
  private readonly logger = new Logger(LeaguesService.name);

  constructor(private readonly prizeAwarder: PromotionPrizeAwarder) {}

  // ──────────────────────────────────────────────────────────────────────
  // CRUD
  // ──────────────────────────────────────────────────────────────────────

  async create(
    db: TenantDb,
    actorUserId: string,
    dto: CreateLeagueDto,
  ): Promise<League> {
    const startsAt = new Date(dto.startsAt);
    const endsAt = new Date(dto.endsAt);
    if (endsAt.getTime() <= startsAt.getTime()) {
      throw new LeagueScheduleInvalidError('endsAt debe ser posterior a startsAt.');
    }

    // Status inicial: scheduled si starts en futuro, active si ya empezó.
    const now = new Date();
    const initialStatus: League['status'] =
      now.getTime() < startsAt.getTime() ? 'scheduled' : 'active';

    const values: NewLeague = {
      code: dto.code,
      name: dto.name,
      period: dto.period,
      metric: dto.metric,
      metricConfig: dto.metricConfig ?? {},
      prizes: dto.prizes ?? {},
      startsAt,
      endsAt,
      status: initialStatus,
      visibility: dto.visibility ?? {},
      fundedByUserId: actorUserId,
      createdByUserId: actorUserId,
    };

    try {
      const inserted = await db.insert(leagues).values(values).returning();
      return inserted[0]!;
    } catch (err: unknown) {
      if (
        err instanceof Error &&
        'code' in err &&
        (err as { code: string }).code === '23505'
      ) {
        throw new LeagueCodeConflictError(dto.code);
      }
      throw err;
    }
  }

  async findById(db: TenantDb, id: string): Promise<League> {
    const rows = await db.select().from(leagues).where(eq(leagues.id, id)).limit(1);
    if (!rows[0]) throw new LeagueNotFoundError(id);
    return rows[0];
  }

  async list(
    db: TenantDb,
    filters: {
      status?: string;
      metric?: string;
      limit?: number;
      offset?: number;
    } = {},
  ): Promise<{ data: League[]; total: number }> {
    const conditions = [];
    if (filters.status)
      conditions.push(eq(leagues.status, filters.status as League['status']));
    if (filters.metric)
      conditions.push(eq(leagues.metric, filters.metric as League['metric']));
    const whereExpr = conditions.length > 0 ? and(...conditions) : undefined;

    const limit = filters.limit ?? 50;
    const offset = filters.offset ?? 0;

    const data = await db
      .select()
      .from(leagues)
      .where(whereExpr)
      .orderBy(desc(leagues.createdAt))
      .limit(limit)
      .offset(offset);

    const totalRow = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(leagues)
      .where(whereExpr);
    return { data, total: totalRow[0]?.count ?? 0 };
  }

  async update(
    db: TenantDb,
    id: string,
    dto: UpdateLeagueDto,
  ): Promise<League> {
    await this.findById(db, id);
    const patch: Partial<NewLeague> = { updatedAt: new Date() };
    if (dto.name !== undefined) patch.name = dto.name;
    if (dto.status !== undefined) patch.status = dto.status;
    if (dto.metricConfig !== undefined) patch.metricConfig = dto.metricConfig;
    if (dto.prizes !== undefined) patch.prizes = dto.prizes;
    if (dto.startsAt !== undefined) patch.startsAt = new Date(dto.startsAt);
    if (dto.endsAt !== undefined) patch.endsAt = new Date(dto.endsAt);
    if (dto.visibility !== undefined) patch.visibility = dto.visibility;

    if (patch.startsAt && patch.endsAt && patch.endsAt.getTime() <= patch.startsAt.getTime()) {
      throw new LeagueScheduleInvalidError('endsAt debe ser posterior a startsAt.');
    }

    const updated = await db
      .update(leagues)
      .set(patch)
      .where(eq(leagues.id, id))
      .returning();
    return updated[0]!;
  }

  // ──────────────────────────────────────────────────────────────────────
  // Recompute standings
  // ──────────────────────────────────────────────────────────────────────

  /**
   * Recalcula completamente el ranking de la league. DELETE existing rows +
   * INSERT batch con scores ordenados.
   *
   * Trade-off vs UPSERT: un DELETE+INSERT atómico es simple y correcto.
   * Para volúmenes muy grandes (>10k participantes), considerar UPSERT
   * para evitar tabla vacía momentáneamente. MVP no necesita.
   */
  async recompute(db: TenantDb, leagueId: string): Promise<LeagueStanding[]> {
    const league = await this.findById(db, leagueId);
    if (!SUPPORTED_METRICS.includes(league.metric)) {
      throw new LeagueMetricNotSupportedError(league.metric);
    }

    const scores = await this.computeScores(db, league);

    // DELETE + INSERT en TX para no dejar tabla vacía en queries
    // concurrentes (locking pesimista del rango sobre league_standings).
    return db.transaction(async (tx) => {
      await tx
        .delete(leagueStandings)
        .where(eq(leagueStandings.leagueId, leagueId));

      if (scores.length === 0) return [];

      const rows: NewLeagueStanding[] = scores.map((s, idx) => ({
        leagueId,
        userId: s.userId,
        score: s.score,
        position: idx + 1, // 1-indexed
        lastUpdatedAt: new Date(),
      }));
      const inserted = await tx
        .insert(leagueStandings)
        .values(rows)
        .returning();
      return inserted.sort((a, b) => a.position - b.position);
    });
  }

  /**
   * Top N + posición del user actual con ventana (1 antes y 1 después).
   * Si el user no está en el ranking, devuelve solo top N.
   */
  async getStandingsView(
    db: TenantDb,
    leagueId: string,
    userId: string | null,
    topN = 10,
  ): Promise<{
    top: Array<{ userId: string; score: string; position: number }>;
    around?: Array<{ userId: string; score: string; position: number }>;
    total: number;
  }> {
    const top = await db
      .select({
        userId: leagueStandings.userId,
        score: leagueStandings.score,
        position: leagueStandings.position,
      })
      .from(leagueStandings)
      .where(eq(leagueStandings.leagueId, leagueId))
      .orderBy(asc(leagueStandings.position))
      .limit(topN);

    const totalRow = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(leagueStandings)
      .where(eq(leagueStandings.leagueId, leagueId));
    const total = totalRow[0]?.count ?? 0;

    if (!userId) return { top, total };

    // Posición del user
    const userRow = await db
      .select({ position: leagueStandings.position })
      .from(leagueStandings)
      .where(
        and(
          eq(leagueStandings.leagueId, leagueId),
          eq(leagueStandings.userId, userId),
        ),
      )
      .limit(1);
    if (!userRow[0]) return { top, total };

    const pos = userRow[0].position;
    if (pos <= topN) return { top, total }; // ya está en top

    // Ventana: pos-1, pos, pos+1.
    const around = await db
      .select({
        userId: leagueStandings.userId,
        score: leagueStandings.score,
        position: leagueStandings.position,
      })
      .from(leagueStandings)
      .where(
        and(
          eq(leagueStandings.leagueId, leagueId),
          gte(leagueStandings.position, pos - 1),
          lt(leagueStandings.position, pos + 2),
        ),
      )
      .orderBy(asc(leagueStandings.position));

    return { top, around, total };
  }

  // ──────────────────────────────────────────────────────────────────────
  // Close + settle
  // ──────────────────────────────────────────────────────────────────────

  /**
   * Cierra la league: re-recompute final → settle premios → status='closed'.
   * Idempotent: re-run sobre league ya cerrada → 0 settled.
   *
   * Falla individual de settle (e.g. premio bonus con definition rota) NO
   * aborta el batch — log + skip a ese user, continuar con los demás.
   */
  async closeAndSettle(db: TenantDb, leagueId: string): Promise<CloseResult> {
    const league = await this.findById(db, leagueId);
    if (league.status !== 'active' && league.status !== 'scheduled') {
      // Ya cerrada → no-op silencioso (idempotent).
      if (league.status === 'closed') {
        return {
          leagueId,
          leagueCode: league.code,
          totalParticipants: 0,
          totalSettled: 0,
          totalSkipped: 0,
          totalFailed: 0,
          failedUserIds: [],
        };
      }
      throw new LeagueNotClosableError(leagueId, league.status);
    }

    // Recompute final con scores frescos.
    const finalStandings = await this.recompute(db, leagueId);

    const prizeMap = this.parsePrizes(league.prizes as Record<string, unknown>);

    const result: CloseResult = {
      leagueId,
      leagueCode: league.code,
      totalParticipants: finalStandings.length,
      totalSettled: 0,
      totalSkipped: 0,
      totalFailed: 0,
      failedUserIds: [],
    };

    for (const standing of finalStandings) {
      const prize = this.prizeForPosition(prizeMap, standing.position);
      if (!prize) {
        result.totalSkipped += 1;
        continue;
      }

      const idempotencyKey = `settle:${standing.userId}`;
      try {
        // Skip si ya hay un league_result con esta key (idempotencia
        // del settle ante re-runs).
        const existing = await db
          .select({ id: leagueResults.id })
          .from(leagueResults)
          .where(
            and(
              eq(leagueResults.leagueId, leagueId),
              eq(leagueResults.idempotencyKey, idempotencyKey),
            ),
          )
          .limit(1);
        if (existing[0]) {
          result.totalSkipped += 1;
          continue;
        }

        const award = await this.prizeAwarder.award(db, {
          context: {
            id: league.id,
            code: league.code,
            fundedByUserId: league.fundedByUserId,
          },
          userId: standing.userId,
          prize,
          idempotencyKeyBase: `league_${league.id}_settle_${standing.userId}`,
        });

        const newRow: NewLeagueResult = {
          leagueId,
          userId: standing.userId,
          finalPosition: standing.position,
          finalScore: standing.score,
          prize,
          walletTxId: award.walletTxId ?? null,
          bonusId: award.bonusId ?? null,
          idempotencyKey,
        };
        await db.insert(leagueResults).values(newRow);
        result.totalSettled += 1;
      } catch (err) {
        result.totalFailed += 1;
        result.failedUserIds.push(standing.userId);
        this.logger.error(
          `Settle league=${league.code} user=${standing.userId} pos=${standing.position}: ${(err as Error).message}`,
        );
      }
    }

    // Marcar como closed.
    await db
      .update(leagues)
      .set({ status: 'closed', updatedAt: new Date() })
      .where(eq(leagues.id, leagueId))
      .returning({ id: leagues.id });

    return result;
  }

  // ──────────────────────────────────────────────────────────────────────
  // Internals
  // ──────────────────────────────────────────────────────────────────────

  /**
   * Calcula el score per user para la métrica de la league. Devuelve
   * ordenado DESC por score (mayor a menor).
   *
   * Filtra por activity en [startsAt, endsAt). Solo users con activity > 0.
   */
  private async computeScores(
    db: TenantDb,
    league: League,
  ): Promise<Array<{ userId: string; score: string }>> {
    const baseConditions = [
      gte(walletTransactions.createdAt, league.startsAt),
      lt(walletTransactions.createdAt, league.endsAt),
      eq(walletTransactions.type, 'bet' as const),
    ];

    if (league.metric === 'bet_volume') {
      const rows = await db
        .select({
          userId: wallets.userId,
          score: sql<string>`coalesce(sum(${walletTransactions.amount}), 0)::text`,
        })
        .from(walletTransactions)
        .innerJoin(wallets, eq(wallets.id, walletTransactions.walletId))
        .where(and(...baseConditions))
        .groupBy(wallets.userId)
        .orderBy(sql`sum(${walletTransactions.amount}) DESC`);
      return rows;
    }

    // rounds_count
    const rows = await db
      .select({
        userId: wallets.userId,
        score: sql<string>`count(*)::text`,
      })
      .from(walletTransactions)
      .innerJoin(wallets, eq(wallets.id, walletTransactions.walletId))
      .where(and(...baseConditions))
      .groupBy(wallets.userId)
      .orderBy(sql`count(*) DESC`);
    return rows;
  }

  /**
   * Parsea el `prizes` JSONB en un map posición → prize. Soporta keys
   * exactas ("1", "2") y rangos ("2-5", "6-10").
   */
  private parsePrizes(raw: Record<string, unknown>): PrizeMapEntry[] {
    const entries: PrizeMapEntry[] = [];
    for (const [key, value] of Object.entries(raw)) {
      const positions = this.parsePositionKey(key);
      if (positions.length === 0) {
        this.logger.warn(`prize key '${key}' inválida — ignorando.`);
        continue;
      }
      entries.push({ positions, prize: value as PromotionPrize });
    }
    return entries;
  }

  private parsePositionKey(key: string): number[] {
    // "1" → [1]. "2-5" → [2,3,4,5]. Otros → [].
    if (/^\d+$/.test(key)) return [parseInt(key, 10)];
    const m = /^(\d+)-(\d+)$/.exec(key);
    if (m) {
      const a = parseInt(m[1]!, 10);
      const b = parseInt(m[2]!, 10);
      if (a <= 0 || b < a) return [];
      const arr: number[] = [];
      for (let i = a; i <= b; i += 1) arr.push(i);
      return arr;
    }
    return [];
  }

  private prizeForPosition(map: PrizeMapEntry[], position: number): PromotionPrize | null {
    for (const entry of map) {
      if (entry.positions.includes(position)) return entry.prize;
    }
    return null;
  }
}
