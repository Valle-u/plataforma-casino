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
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { games, type Game, type NewGame } from '@casino/db';
import type { TenantDb } from '../tenant-resolver/tenant-context';
import type { CreateGameDto, UpdateGameDto } from './dto/game.dto';
import { GameCodeConflictError, GameNotFoundError } from './games.errors';

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
      if (
        err instanceof Error &&
        'code' in err &&
        (err as { code: string }).code === '23505'
      ) {
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
