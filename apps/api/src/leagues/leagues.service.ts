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
import { and, asc, desc, eq, getTableColumns, gte, inArray, lt, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import {
  leagueResults,
  leagueStandings,
  leagues,
  users,
  wallets,
  walletTransactions,
  type League,
  type LeagueStanding,
  type NewLeague,
  type NewLeagueResult,
  type NewLeagueStanding,
} from '@casino/db';
import { ActorRoleService } from '../common/actor-role.service';
import { isUniqueViolation } from '../common/pg-error';
import type { TenantDb } from '../tenant-resolver/tenant-context';
import { FraudDetectionService } from '../fraud/fraud-detection.service';
import {
  PromotionPrizeAwarder,
  type PromotionPrize,
} from '../promotions/prize-awarder.service';
import {
  LeagueActorRoleError,
  LeagueCodeConflictError,
  LeagueMetricNotSupportedError,
  LeagueNotClosableError,
  LeagueNotFoundError,
  LeaguePrizesShapeError,
  LeagueScheduleInvalidError,
} from './leagues.errors';
import type {
  CreateLeagueDto,
  UpdateLeagueDto,
} from './dto/league.dto';

// Sprint 51.8.1: agregamos gross_won, player_netwin y score_custom.
// `score_custom` requiere `metricConfig.formula` apuntando a una de las
// otras métricas — placeholder para fórmulas más complejas a futuro.
const SUPPORTED_METRICS: ReadonlyArray<League['metric']> = [
  'bet_volume',
  'rounds_count',
  'gross_won',
  'player_netwin',
  'score_custom',
];

interface PrizeMapEntry {
  positions: number[]; // posiciones que matchean esta entry
  prize: PromotionPrize;
}

/**
 * Sprint 51.8.1: standing row enriquecida con username/displayName.
 * `username`/`displayName` pueden ser null si el user fue borrado
 * (referencia colgada del leftJoin).
 */
export interface EnrichedStanding {
  userId: string;
  score: string;
  position: number;
  username: string | null;
  displayName: string | null;
}

/**
 * League del listado + count de participantes + usernames legibles del
 * funder/creador para los exports CSV (aditivos; el panel los ignora).
 */
export interface LeagueListRow extends League {
  participantsCount: number;
  fundedByUsername: string | null;
  createdByUsername: string | null;
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

  constructor(
    private readonly prizeAwarder: PromotionPrizeAwarder,
    private readonly fraudService: FraudDetectionService,
    private readonly actorRole: ActorRoleService,
  ) {}

  // ──────────────────────────────────────────────────────────────────────
  // CRUD
  // ──────────────────────────────────────────────────────────────────────

  async create(
    db: TenantDb,
    actorUserId: string,
    dto: CreateLeagueDto,
  ): Promise<League> {
    // Sprint 51.2: gate de rol — leagues son "servicio plataforma".
    // Solo admin_tenant crea; aplica a TODOS los players (incluso bajo
    // socios independent). Funder = actor (admin's wallet paga prizes).
    const isAdmin = await this.actorRole.isAdminTenant(db, actorUserId);
    if (!isAdmin) {
      throw new LeagueActorRoleError(actorUserId);
    }

    const startsAt = new Date(dto.startsAt);
    const endsAt = new Date(dto.endsAt);
    if (endsAt.getTime() <= startsAt.getTime()) {
      throw new LeagueScheduleInvalidError('endsAt debe ser posterior a startsAt.');
    }

    // Status inicial: si el caller lo pasó explícito (Sprint 51.8), lo
    // honramos — útil para sims/seeding que crean ligas que arrancan
    // ahora mismo. Si no, fallback al heurístico start-futuro vs pasado.
    const now = new Date();
    const initialStatus: League['status'] =
      dto.status ?? (now.getTime() < startsAt.getTime() ? 'scheduled' : 'active');

    // Sprint 51.8.1: validar shape de prizes en el create (antes solo
    // se chequeaba en el close, donde un shape mal-formado dejaba la
    // liga "sin premios" silenciosamente).
    if (dto.prizes !== undefined) {
      this.validatePrizesShape(dto.prizes);
    }

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
      if (isUniqueViolation(err)) {
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
  ): Promise<{
    data: LeagueListRow[];
    total: number;
  }> {
    const conditions = [];
    if (filters.status)
      conditions.push(eq(leagues.status, filters.status as League['status']));
    if (filters.metric)
      conditions.push(eq(leagues.metric, filters.metric as League['metric']));
    const whereExpr = conditions.length > 0 ? and(...conditions) : undefined;

    const limit = filters.limit ?? 50;
    const offset = filters.offset ?? 0;

    // Self-joins a `users` para los usernames de funder/creador (exports CSV).
    const funder = alias(users, 'funder_user');
    const creator = alias(users, 'creator_user');
    const rows = await db
      .select({
        ...getTableColumns(leagues),
        fundedByUsername: funder.username,
        createdByUsername: creator.username,
      })
      .from(leagues)
      .leftJoin(funder, eq(funder.id, leagues.fundedByUserId))
      .leftJoin(creator, eq(creator.id, leagues.createdByUserId))
      .where(whereExpr)
      .orderBy(desc(leagues.createdAt))
      .limit(limit)
      .offset(offset);

    // Sprint 51.8.1: live count de participants por league. Una sola
    // query agregada en vez de N+1: SELECT league_id, count(*) FROM
    // league_standings WHERE league_id IN (...) GROUP BY league_id.
    const ids = rows.map((r) => r.id);
    const countsMap = new Map<string, number>();
    if (ids.length > 0) {
      const countRows = await db
        .select({
          leagueId: leagueStandings.leagueId,
          n: sql<number>`count(*)::int`,
        })
        .from(leagueStandings)
        .where(inArray(leagueStandings.leagueId, ids))
        .groupBy(leagueStandings.leagueId);
      for (const c of countRows) {
        countsMap.set(c.leagueId, c.n);
      }
    }
    const data: LeagueListRow[] = rows.map((r) => ({
      ...r,
      participantsCount: countsMap.get(r.id) ?? 0,
    }));

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
    actorUserId?: string,
  ): Promise<League> {
    await this.findById(db, id);
    if (actorUserId !== undefined) {
      const isAdmin = await this.actorRole.isAdminTenant(db, actorUserId);
      if (!isAdmin) {
        throw new LeagueActorRoleError(actorUserId);
      }
    }
    // Sprint 51.8.1: validar shape de prizes si vienen en el patch.
    if (dto.prizes !== undefined) {
      this.validatePrizesShape(dto.prizes);
    }

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

    const scoresRaw = await this.computeScores(db, league);

    // Antifraude (doc 15 §C6): excluir users en clusters
    // suspected/confirmed con score >= threshold. Batch query antes del
    // filter para evitar N+1.
    const flagged = await this.fraudService.getFlaggedUserIds(db);
    const scores = flagged.size === 0
      ? scoresRaw
      : scoresRaw.filter((s) => !flagged.has(s.userId));
    if (scoresRaw.length !== scores.length) {
      this.logger.log(
        `Recompute league=${league.code}: ${scoresRaw.length - scores.length} flagged user(s) excluidos.`,
      );
    }

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

  // EnrichedStanding type — usado por getStandingsView y settlePreview.
  // Mantiene `userId` para no romper consumers, pero ahora trae también
  // `username` y `displayName` para que el UI muestre nombre legible.

  /**
   * Top N + posición del user actual con ventana (1 antes y 1 después).
   * Si el user no está en el ranking, devuelve solo top N.
   *
   * Sprint 51.8.1: enriquece con `username` + `displayName` via JOIN —
   * el panel admin antes mostraba `userId.slice(0,13)`, ahora muestra
   * nombre legible.
   */
  async getStandingsView(
    db: TenantDb,
    leagueId: string,
    userId: string | null,
    topN = 10,
  ): Promise<{
    top: Array<EnrichedStanding>;
    around?: Array<EnrichedStanding>;
    total: number;
  }> {
    const top = await db
      .select({
        userId: leagueStandings.userId,
        score: leagueStandings.score,
        position: leagueStandings.position,
        username: users.username,
        displayName: users.displayName,
      })
      .from(leagueStandings)
      .leftJoin(users, eq(users.id, leagueStandings.userId))
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
        username: users.username,
        displayName: users.displayName,
      })
      .from(leagueStandings)
      .leftJoin(users, eq(users.id, leagueStandings.userId))
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
  // Sprint 51.8.1: preview pre-close (read-only)
  // ──────────────────────────────────────────────────────────────────────

  /**
   * Devuelve el ranking actual + qué premio cobraría cada posición SI
   * cerrara ahora. NO modifica nada (no recompute, no insert).
   *
   * Útil para que el admin haga sanity-check antes del close definitivo:
   *   - "Cuántos players entrarían en zona de premios?"
   *   - "Quién quedaría afuera por un punto?"
   *   - "Los premios están bien armados (no overlap, suma esperada)?"
   *
   * Lee del `league_standings` actual (último recompute). Si nunca corrió
   * recompute, devuelve `{ standings: [], prizesUnassigned: [...] }`.
   */
  async settlePreview(
    db: TenantDb,
    leagueId: string,
  ): Promise<{
    leagueId: string;
    leagueStatus: League['status'];
    standings: Array<
      EnrichedStanding & { prize: PromotionPrize | null }
    >;
    summary: {
      totalParticipants: number;
      withPrize: number;
      withoutPrize: number;
      totalChipsToAward: number;
    };
    prizesUnassigned: Array<{ position: number; prize: PromotionPrize }>;
  }> {
    const league = await this.findById(db, leagueId);
    const prizeMap = this.parsePrizes(
      (league.prizes ?? {}) as Record<string, unknown>,
    );

    const standings = await db
      .select({
        position: leagueStandings.position,
        userId: leagueStandings.userId,
        score: leagueStandings.score,
        username: users.username,
        displayName: users.displayName,
      })
      .from(leagueStandings)
      .leftJoin(users, eq(users.id, leagueStandings.userId))
      .where(eq(leagueStandings.leagueId, leagueId))
      .orderBy(asc(leagueStandings.position));

    let withPrize = 0;
    let totalChips = 0;
    const enriched = standings.map((s) => {
      const prize = this.prizeForPosition(prizeMap, s.position);
      if (prize) {
        withPrize += 1;
        if (prize.kind === 'chips') totalChips += Number(prize.amount);
      }
      return { ...s, prize };
    });

    // Premios definidos en posiciones que nadie alcanza (ej. prize en pos 50
    // pero solo hay 30 participantes). Útil para warning visual.
    const occupiedPositions = new Set(standings.map((s) => s.position));
    const prizesUnassigned: Array<{ position: number; prize: PromotionPrize }> =
      [];
    for (const entry of prizeMap) {
      for (const pos of entry.positions) {
        if (!occupiedPositions.has(pos)) {
          prizesUnassigned.push({ position: pos, prize: entry.prize });
        }
      }
    }

    return {
      leagueId,
      leagueStatus: league.status,
      standings: enriched,
      summary: {
        totalParticipants: standings.length,
        withPrize,
        withoutPrize: standings.length - withPrize,
        totalChipsToAward: totalChips,
      },
      prizesUnassigned,
    };
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
   *
   * Sprint 51.8.1: agregadas gross_won (sum de wins), player_netwin
   * (wins - bets, puede ser negativo) y score_custom (delegated por
   * `metricConfig.formula` a otra métrica). Antes solo bet_volume y
   * rounds_count.
   */
  private async computeScores(
    db: TenantDb,
    league: League,
  ): Promise<Array<{ userId: string; score: string }>> {
    // score_custom: delega al `formula` (otra métrica) — placeholder
    // hasta tener fórmulas reales. Si formula es inválida, fallback a
    // bet_volume.
    if (league.metric === 'score_custom') {
      const formula = (league.metricConfig as { formula?: string } | null)
        ?.formula;
      const target = (
        formula && SUPPORTED_METRICS.includes(formula as League['metric'])
          ? formula
          : 'bet_volume'
      ) as League['metric'];
      if (target === 'score_custom') {
        // Evitamos recursión — fallback duro.
        return this.computeScores(db, { ...league, metric: 'bet_volume' });
      }
      return this.computeScores(db, { ...league, metric: target });
    }

    const windowConditions = [
      gte(walletTransactions.createdAt, league.startsAt),
      lt(walletTransactions.createdAt, league.endsAt),
    ];

    if (league.metric === 'bet_volume') {
      const rows = await db
        .select({
          userId: wallets.userId,
          score: sql<string>`coalesce(sum(${walletTransactions.amount}), 0)::text`,
        })
        .from(walletTransactions)
        .innerJoin(wallets, eq(wallets.id, walletTransactions.walletId))
        .where(and(eq(walletTransactions.type, 'bet' as const), ...windowConditions))
        .groupBy(wallets.userId)
        .orderBy(sql`sum(${walletTransactions.amount}) DESC`);
      return rows;
    }

    if (league.metric === 'rounds_count') {
      const rows = await db
        .select({
          userId: wallets.userId,
          score: sql<string>`count(*)::text`,
        })
        .from(walletTransactions)
        .innerJoin(wallets, eq(wallets.id, walletTransactions.walletId))
        .where(and(eq(walletTransactions.type, 'bet' as const), ...windowConditions))
        .groupBy(wallets.userId)
        .orderBy(sql`count(*) DESC`);
      return rows;
    }

    if (league.metric === 'gross_won') {
      // Suma de premios brutos (type='win') en la ventana.
      const rows = await db
        .select({
          userId: wallets.userId,
          score: sql<string>`coalesce(sum(${walletTransactions.amount}), 0)::text`,
        })
        .from(walletTransactions)
        .innerJoin(wallets, eq(wallets.id, walletTransactions.walletId))
        .where(and(eq(walletTransactions.type, 'win' as const), ...windowConditions))
        .groupBy(wallets.userId)
        .orderBy(sql`sum(${walletTransactions.amount}) DESC`);
      return rows;
    }

    // player_netwin = SUM(wins) - SUM(bets). Puede ser negativo.
    // Usamos un SELECT con CASE WHEN para una sola query agregada.
    if (league.metric === 'player_netwin') {
      const rows = await db
        .select({
          userId: wallets.userId,
          score: sql<string>`coalesce(
            sum(case when ${walletTransactions.type} = 'win' then ${walletTransactions.amount} else 0 end)
            - sum(case when ${walletTransactions.type} = 'bet' then ${walletTransactions.amount} else 0 end),
            0
          )::text`,
        })
        .from(walletTransactions)
        .innerJoin(wallets, eq(wallets.id, walletTransactions.walletId))
        .where(
          and(
            inArray(walletTransactions.type, ['bet' as const, 'win' as const]),
            ...windowConditions,
          ),
        )
        .groupBy(wallets.userId)
        .orderBy(
          sql`(
            sum(case when ${walletTransactions.type} = 'win' then ${walletTransactions.amount} else 0 end)
            - sum(case when ${walletTransactions.type} = 'bet' then ${walletTransactions.amount} else 0 end)
          ) DESC`,
        );
      return rows;
    }

    // Defensive — no debería llegar acá por el `SUPPORTED_METRICS` guard.
    throw new LeagueMetricNotSupportedError(league.metric);
  }

  /**
   * Sprint 51.8.1: Valida la estructura de `prizes` al create/edit.
   *
   * Shape esperada:
   *   { "1": Prize, "2-5": Prize, ... }
   *
   * Reglas:
   *   - Debe ser un objeto plano (no array, no null).
   *   - Cada key debe matchear `^\d+$` o `^\d+-\d+$` (rangos válidos).
   *   - Posiciones no pueden overlap entre keys (ej. "5" y "5-10" → error).
   *   - Cada value debe tener `kind` ∈ { chips, bonus, free_spins, try_again }
   *     con los campos requeridos por kind.
   *
   * Tira `LeaguePrizesShapeError` con mensaje específico. Vacío (`{}`) es
   * válido — significa "sin premios" (la liga corre pero no settle).
   */
  validatePrizesShape(raw: unknown): void {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new LeaguePrizesShapeError(
        'debe ser un objeto plano { "1": Prize, "2-5": Prize, ... }',
      );
    }
    const seen = new Set<number>();
    for (const [key, value] of Object.entries(raw)) {
      const positions = this.parsePositionKey(key);
      if (positions.length === 0) {
        throw new LeaguePrizesShapeError(
          `key '${key}' no es una posición válida (esperado "N" o "N-M" con N,M>0 y M>=N)`,
        );
      }
      for (const p of positions) {
        if (seen.has(p)) {
          throw new LeaguePrizesShapeError(
            `posición ${p} aparece en múltiples keys (overlap con otra entry)`,
          );
        }
        seen.add(p);
      }
      this.validatePrizeValue(key, value);
    }
  }

  private validatePrizeValue(key: string, value: unknown): void {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      throw new LeaguePrizesShapeError(
        `prize en key '${key}' debe ser un objeto`,
      );
    }
    const v = value as Record<string, unknown>;
    const kind = v.kind;
    if (kind === 'chips') {
      if (
        (typeof v.amount !== 'number' && typeof v.amount !== 'string') ||
        Number(v.amount) <= 0
      ) {
        throw new LeaguePrizesShapeError(
          `prize key '${key}' kind=chips requiere amount > 0`,
        );
      }
    } else if (kind === 'bonus') {
      if (typeof v.definitionId !== 'string' || v.definitionId.length === 0) {
        throw new LeaguePrizesShapeError(
          `prize key '${key}' kind=bonus requiere definitionId (UUID)`,
        );
      }
      if (
        (typeof v.amount !== 'number' && typeof v.amount !== 'string') ||
        Number(v.amount) <= 0
      ) {
        throw new LeaguePrizesShapeError(
          `prize key '${key}' kind=bonus requiere amount > 0`,
        );
      }
    } else if (kind === 'free_spins') {
      if (typeof v.count !== 'number' || v.count <= 0) {
        throw new LeaguePrizesShapeError(
          `prize key '${key}' kind=free_spins requiere count > 0`,
        );
      }
    } else if (kind === 'try_again') {
      // sin payload adicional — OK
    } else {
      throw new LeaguePrizesShapeError(
        `prize key '${key}' kind='${String(kind)}' no soportado (chips|bonus|free_spins|try_again)`,
      );
    }
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
