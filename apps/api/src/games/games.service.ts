/**
 * GamesService — CRUD del catálogo de games del tenant.
 *
 * Operaciones:
 *   - list(filters): admin lista con type/active filters.
 *   - listActiveForPlayer(filters): player-facing, solo isActive=true.
 *   - findById / findByCode.
 *   - create / update / archive.
 *
 * El `code` es la primary identifier desde la URL del jugador
 * (`/play/games/<code>`). Único intra-tenant.
 *
 * Sprint 34 deja CRUD. Sprint 35 mete launch/bet/win via GameSessionsService
 * + GameRoundsService + IGameProvider adapter.
 */

import { Injectable } from '@nestjs/common';
import { and, asc, desc, eq, gt, sql } from 'drizzle-orm';
import {
  gameRounds,
  games,
  users,
  type Game,
  type NewGame,
} from '@casino/db';
import type { TenantDb } from '../tenant-resolver/tenant-context';
import type { CreateGameDto, UpdateGameDto } from './dto/game.dto';
import { GameCodeConflictError, GameNotFoundError } from './games.errors';
import { isUniqueViolation } from '../common/pg-error';

/**
 * Shape de un win row anonimizado para el feed público "Recent Wins".
 * Sprint 52.1.
 */
export interface RecentPublicWin {
  /** ID del round (no se devuelve para player ajeno por privacidad, sirve como key). */
  id: string;
  /** Username anonimizado: primeras 3 letras + asteriscos. */
  username: string;
  /** Monto ganado en chips (positive). */
  amount: string;
  /** Nombre del juego (visible). */
  gameName: string;
  gameCategory: Game['category'];
  /** Cuándo se settled el round. */
  settledAt: Date;
}

export interface ListGamesFilters {
  category?: Game['category'];
  activeOnly?: boolean;
  featuredOnly?: boolean;
  limit?: number;
  offset?: number;
}

@Injectable()
export class GamesService {
  async list(
    db: TenantDb,
    filters: ListGamesFilters = {},
  ): Promise<{ data: Game[]; total: number }> {
    const conditions = [];
    if (filters.category) conditions.push(eq(games.category, filters.category));
    if (filters.activeOnly) conditions.push(eq(games.isActive, true));
    if (filters.featuredOnly) conditions.push(eq(games.featured, true));
    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const limit = Math.min(Math.max(filters.limit ?? 100, 1), 500);
    const offset = Math.max(filters.offset ?? 0, 0);

    const data = await db
      .select()
      .from(games)
      .where(where)
      .orderBy(asc(games.category), asc(games.sortOrder), desc(games.createdAt))
      .limit(limit)
      .offset(offset);

    const total = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(games)
      .where(where);

    return { data, total: total[0]?.n ?? 0 };
  }

  /**
   * Sprint 52.1 — Recent public wins feed.
   *
   * Devuelve los últimos N rounds settled con win > 0, anonimizando
   * usernames. Player-facing: cualquier user logueado puede consumir.
   * Sin paginación (es un feed live, limit cap razonable 50).
   *
   * Privacidad:
   *   - El username se anonimiza server-side a "leo***" (3 chars + asterisks).
   *     Nunca devolvemos el username completo ni el display_name.
   *   - El user_id NO se devuelve.
   *   - El ID del round SÍ (sirve para React key). No es PII por sí solo.
   *
   * Performance: joinea sólo gameRounds → games → users por user_id.
   * Indexes existentes en `game_rounds_user_placed` cubren la query si
   * filtramos por user, pero para el feed global vamos sin filtro user
   * + status='settled' + win_amount > 0 + ORDER BY settled_at DESC LIMIT.
   * Postgres elige seq scan + sort top-N (perf OK hasta 100k rounds; si
   * escala más, sumar `idx_game_rounds_settled_at_win` parcial).
   */
  async listRecentPublicWins(
    db: TenantDb,
    limit: number,
  ): Promise<RecentPublicWin[]> {
    const cap = Math.min(Math.max(limit, 1), 50);
    const rows = await db
      .select({
        id: gameRounds.id,
        amount: gameRounds.winAmount,
        settledAt: gameRounds.settledAt,
        gameName: games.name,
        gameCategory: games.category,
        username: users.username,
      })
      .from(gameRounds)
      .innerJoin(games, eq(games.id, gameRounds.gameId))
      .innerJoin(users, eq(users.id, gameRounds.userId))
      .where(
        and(
          eq(gameRounds.status, 'settled'),
          gt(gameRounds.winAmount, '0'),
        ),
      )
      .orderBy(desc(gameRounds.settledAt))
      .limit(cap);

    return rows
      .filter((r): r is typeof r & { settledAt: Date } => r.settledAt != null)
      .map((r) => ({
        id: r.id,
        username: anonymizeUsername(r.username),
        amount: r.amount,
        gameName: r.gameName,
        gameCategory: r.gameCategory,
        settledAt: r.settledAt,
      }));
  }

  /**
   * Player-facing: solo isActive=true. Sin paginación — cap 200 (un
   * tenant no debería tener más juegos activos que eso en MVP).
   */
  async listActiveForPlayer(
    db: TenantDb,
    filters: { category?: Game['category']; featuredOnly?: boolean } = {},
  ): Promise<Game[]> {
    const conditions = [eq(games.isActive, true)];
    if (filters.category) conditions.push(eq(games.category, filters.category));
    if (filters.featuredOnly) conditions.push(eq(games.featured, true));
    return db
      .select()
      .from(games)
      .where(and(...conditions))
      .orderBy(asc(games.category), asc(games.sortOrder))
      .limit(200);
  }

  async findById(db: TenantDb, id: string): Promise<Game> {
    const rows = await db
      .select()
      .from(games)
      .where(eq(games.id, id))
      .limit(1);
    if (!rows[0]) throw new GameNotFoundError(id);
    return rows[0];
  }

  async findByCode(db: TenantDb, code: string): Promise<Game> {
    const rows = await db
      .select()
      .from(games)
      .where(eq(games.code, code))
      .limit(1);
    if (!rows[0]) throw new GameNotFoundError(code);
    return rows[0];
  }

  async create(db: TenantDb, dto: CreateGameDto): Promise<Game> {
    const values: NewGame = {
      code: dto.code,
      name: dto.name,
      providerCode: dto.providerCode ?? 'mock',
      category: dto.category,
      thumbnailUrl: dto.thumbnailUrl ?? null,
      shortDescription: dto.shortDescription ?? null,
      config: dto.config ?? {},
      featured: dto.featured ?? false,
      sortOrder: dto.sortOrder ?? 0,
      isActive: dto.isActive ?? true,
    };
    try {
      const inserted = await db.insert(games).values(values).returning();
      return inserted[0]!;
    } catch (err: unknown) {
      if (isUniqueViolation(err)) {
        throw new GameCodeConflictError(dto.code);
      }
      throw err;
    }
  }

  async update(
    db: TenantDb,
    id: string,
    dto: UpdateGameDto,
  ): Promise<Game> {
    await this.findById(db, id); // 404 si no existe
    const set: Partial<NewGame> = { updatedAt: new Date() };
    if (dto.name !== undefined) set.name = dto.name;
    if (dto.thumbnailUrl !== undefined) set.thumbnailUrl = dto.thumbnailUrl;
    if (dto.shortDescription !== undefined) {
      set.shortDescription = dto.shortDescription;
    }
    if (dto.config !== undefined) set.config = dto.config;
    if (dto.featured !== undefined) set.featured = dto.featured;
    if (dto.sortOrder !== undefined) set.sortOrder = dto.sortOrder;
    if (dto.isActive !== undefined) set.isActive = dto.isActive;

    const updated = await db
      .update(games)
      .set(set)
      .where(eq(games.id, id))
      .returning();
    return updated[0]!;
  }

  /** Soft-delete: pasa isActive=false. */
  async archive(db: TenantDb, id: string): Promise<Game> {
    return this.update(db, id, { isActive: false });
  }
}

/**
 * Anonimiza username para feeds públicos. "leonardo" → "leo***" /
 * "lu" → "lu*" / "a" → "a*" (siempre asterisks aunque sea cortito,
 * mantiene la sensación de "hay alguien").
 *
 * Sprint 52.1 — usado por listRecentPublicWins().
 */
function anonymizeUsername(username: string): string {
  if (!username) return '***';
  const visible = Math.min(3, Math.max(1, Math.floor(username.length / 2)));
  return `${username.slice(0, visible)}***`;
}
