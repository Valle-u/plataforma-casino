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

import { Injectable, Logger } from '@nestjs/common';
import {
  and,
  asc,
  desc,
  eq,
  gt,
  inArray,
  isNotNull,
  notInArray,
  or,
  sql,
} from 'drizzle-orm';
import {
  gameRounds,
  games,
  users,
  type Game,
  type NewGame,
} from '@casino/db';
import type { TenantDb } from '../tenant-resolver/tenant-context';
import { TenantSettingsService } from '../tenant-settings/tenant-settings.service';
import { PalaceClient } from './providers/palace/palace-client';
import { GameProvidersService } from './game-providers.service';
import type { CreateGameDto, UpdateGameDto } from './dto/game.dto';
import {
  GameCodeConflictError,
  GameInvalidConfigError,
  GameNotFoundError,
} from './games.errors';
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
  /** Filtro por estado de visibilidad para el panel admin. */
  status?: 'visible' | 'hidden' | 'disabled' | 'inactive';
  /** Filtro por proveedor (provider_code). */
  providerCode?: string;
  /** Búsqueda por nombre o code. */
  search?: string;
  limit?: number;
  offset?: number;
}

@Injectable()
export class GamesService {
  private readonly logger = new Logger(GamesService.name);

  /** Key de settings donde se persiste provider_id → nombre oficial. */
  private readonly PROVIDER_NAMES_KEY = 'palace.provider_names';

  /** Fallback negativo en memoria: si Palace no responde, no lo golpeamos
   *  de nuevo durante 60s (el lobby pide /providers por cada sesión). */
  private readonly providerNamesFailCache = new WeakMap<TenantDb, { at: number }>();
  private readonly FAIL_CACHE_TTL_MS = 60 * 1000;

  constructor(
    private readonly settings: TenantSettingsService,
    private readonly palace: PalaceClient,
    private readonly providers: GameProvidersService,
  ) {}

  async list(
    db: TenantDb,
    filters: ListGamesFilters = {},
  ): Promise<{ data: Game[]; total: number }> {
    const conditions = [];
    if (filters.category) conditions.push(eq(games.category, filters.category));
    if (filters.activeOnly) conditions.push(eq(games.isActive, true));
    if (filters.featuredOnly) conditions.push(eq(games.featured, true));
    if (filters.providerCode)
      conditions.push(eq(games.providerCode, filters.providerCode));
    if (filters.status === 'visible') {
      conditions.push(eq(games.isActive, true));
      conditions.push(eq(games.isHidden, false));
      conditions.push(eq(games.isDisabled, false));
    } else if (filters.status === 'hidden') {
      conditions.push(eq(games.isHidden, true));
    } else if (filters.status === 'disabled') {
      conditions.push(eq(games.isDisabled, true));
    } else if (filters.status === 'inactive') {
      conditions.push(eq(games.isActive, false));
    }
    if (filters.search && filters.search.trim() !== '') {
      const s = `%${filters.search.trim().toLowerCase()}%`;
      conditions.push(
        sql`(LOWER(${games.name}) LIKE ${s} OR LOWER(${games.code}) LIKE ${s})`,
      );
    }
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
   * Devuelve el mapa de provider_id → display name.
   *
   * Fuente primaria: `palace.provider_names` en tenant_settings (lo
   * persiste el sync de Palace). Si todavía está vacío (ej. antes del
   * primer sync), lo resuelve on-the-fly desde la Main API de Palace
   * (`/v4/game/providers`) y lo persiste — el lobby muestra los nombres
   * oficiales apenas arranca, sin esperar el sync diario.
   */
  async getProviderNames(
    db: TenantDb,
  ): Promise<Record<number, string>> {
    const stored = await this.settings.get<Record<number, string>>(
      db,
      this.PROVIDER_NAMES_KEY,
    );
    if (stored && Object.keys(stored).length > 0) return stored;
    return this.resolveAndPersistProviderNames(db);
  }

  /** Resuelve nombres desde Palace y los persiste. Best-effort. */
  private async resolveAndPersistProviderNames(
    db: TenantDb,
  ): Promise<Record<number, string>> {
    const failed = this.providerNamesFailCache.get(db);
    if (failed && Date.now() - failed.at < this.FAIL_CACHE_TTL_MS) return {};

    try {
      const providers = await this.palace.gameProviders(db);
      const map: Record<number, string> = {};
      for (const p of providers) {
        const name = p.provider_name?.trim();
        if (p.provider_id != null && name) map[p.provider_id] = name;
      }
      if (Object.keys(map).length > 0) {
        await this.settings.set(db, this.PROVIDER_NAMES_KEY, map, null);
        this.logger.log(`Provider names resueltos vía API (${Object.keys(map).length} proveedores).`);
      }
      return map;
    } catch (err) {
      this.logger.warn(`No se pudieron resolver provider names vía API: ${(err as Error).message}`);
      this.providerNamesFailCache.set(db, { at: Date.now() });
      return {};
    }
  }

  /**
   * Player-facing: solo isActive=true. Con paginación offset-based y búsqueda.
   */
  async listActiveForPlayer(
    db: TenantDb,
    filters: {
      category?: Game['category'];
      providerId?: number;
      /** Sprint 57: true → solo juegos de proveedores SIN nombre oficial
       *  (el chip "Otros" del lobby). Complementa el filtro por providerId. */
      providerNoName?: boolean;
      /** Filtro por adapter (provider_code): 'palace' | 'forever'. Para el
       *  filtro por proveedor del lobby multi-proveedor. */
      providerCode?: string;
      featuredOnly?: boolean;
      search?: string;
      limit?: number;
      offset?: number;
    } = {},
  ): Promise<{ data: Game[]; total: number; limit: number; offset: number; hasMore: boolean }> {
    const limit = Math.min(Math.max(filters.limit ?? 30, 1), 100);
    const offset = Math.max(filters.offset ?? 0, 0);
    const conditions = [eq(games.isActive, true)];
    // Overrides manuales del admin: los ocultos y los deshabilitados no salen
    // en el lobby (un juego que anda mal no se muestra). Los ocultos SÍ se
    // pueden abrir por link directo (eso lo permite el launch), pero no acá.
    conditions.push(eq(games.isHidden, false));
    conditions.push(eq(games.isDisabled, false));
    // Proveedores no operativos (deshabilitados o en mantenimiento): sus juegos
    // se excluyen del lobby.
    const blocked = await this.providers.getBlockedProviderCodes(db);
    if (blocked.length > 0) {
      conditions.push(notInArray(games.providerCode, blocked));
    }
    if (filters.category) conditions.push(eq(games.category, filters.category));
    if (filters.providerCode) conditions.push(eq(games.providerCode, filters.providerCode));
    if (filters.providerId !== undefined) conditions.push(eq(games.palaceProviderId, filters.providerId));
    // "Otros": mutuamente excluyente con un providerId concreto.
    if (filters.providerNoName && filters.providerId === undefined) {
      const namedIds = Object.keys(await this.getProviderNames(db)).map(Number);
      // Juegos con provider asignado pero cuyo provider no tiene nombre.
      conditions.push(isNotNull(games.palaceProviderId));
      if (namedIds.length > 0) conditions.push(notInArray(games.palaceProviderId, namedIds));
    }
    if (filters.featuredOnly) conditions.push(eq(games.featured, true));
    if (filters.search && filters.search.trim() !== '') {
      const term = filters.search.trim().toLowerCase();
      const like = `%${term}%`;
      // Palace: el nombre del estudio NO está en la tabla `games` sino en el
      // mapa provider_id → nombre (tenant_settings). Resolvemos qué provider_ids
      // matchean el término para poder buscar "pragmatic", "pgsoft", etc.
      const names = await this.getProviderNames(db);
      const matchedProviderIds = Object.entries(names)
        .filter(([, name]) => name.toLowerCase().includes(term))
        .map(([id]) => Number(id))
        .filter((n) => Number.isFinite(n));
      // Busca por: nombre/código del juego, código del adapter
      // (palace/forever), vendor de Forever (config.forever.vendorCode, ej.
      // 'slot-pragmatic') y estudio de Palace (provider_ids resueltos arriba).
      conditions.push(
        or(
          sql`LOWER(${games.name}) LIKE ${like}`,
          sql`LOWER(${games.code}) LIKE ${like}`,
          sql`LOWER(${games.providerCode}) LIKE ${like}`,
          sql`LOWER(${games.config} -> 'forever' ->> 'vendorCode') LIKE ${like}`,
          matchedProviderIds.length > 0
            ? inArray(games.palaceProviderId, matchedProviderIds)
            : undefined,
        )!,
      );
    }

    const where = and(...conditions);

    const [data, countResult] = await Promise.all([
      db
        .select()
        .from(games)
        .where(where)
        .orderBy(asc(games.category), asc(games.sortOrder))
        .limit(limit)
        .offset(offset),
      db
        .select({ total: sql<number>`count(*)::int` })
        .from(games)
        .where(where),
    ]);

    const total = countResult[0]?.total ?? 0;
    return {
      data,
      total,
      limit,
      offset,
      hasMore: offset + limit < total,
    };
  }

  /**
   * Player-facing: conteos reales para armar los filtros del lobby y las
   * secciones de la home SIN números hardcodeados. Aplica la MISMA base de
   * visibilidad que `listActiveForPlayer` (activo, no oculto, no deshabilitado,
   * proveedor operativo) para que los counts coincidan con lo que se lista.
   *
   * Devuelve, en una sola pasada:
   *  - `total`: juegos visibles.
   *  - `categories`: [{category, count}] ordenado por count desc.
   *  - `studios`: [{palaceProviderId, count}] ordenado por count desc (incluye
   *     `null` para juegos sin estudio asignado; el front lo mapea a "Otros").
   */
  async getFacetsForPlayer(
    db: TenantDb,
    opts: { category?: Game['category'] } = {},
  ): Promise<{
    total: number;
    categories: { category: Game['category']; count: number }[];
    studios: { palaceProviderId: number | null; count: number }[];
  }> {
    const conditions = [
      eq(games.isActive, true),
      eq(games.isHidden, false),
      eq(games.isDisabled, false),
    ];
    const blocked = await this.providers.getBlockedProviderCodes(db);
    if (blocked.length > 0) {
      conditions.push(notInArray(games.providerCode, blocked));
    }
    // Los conteos de estudio se acotan a la categoría elegida (así un estudio de
    // slots no aparece con games=0 cuando el jugador está en "Crash"). El
    // conteo por categoría global lo pide el front SIN este filtro.
    if (opts.category) conditions.push(eq(games.category, opts.category));
    const where = and(...conditions);

    const [cats, studios, totalResult] = await Promise.all([
      db
        .select({
          category: games.category,
          count: sql<number>`count(*)::int`,
        })
        .from(games)
        .where(where)
        .groupBy(games.category),
      db
        .select({
          palaceProviderId: games.palaceProviderId,
          count: sql<number>`count(*)::int`,
        })
        .from(games)
        .where(where)
        .groupBy(games.palaceProviderId),
      db
        .select({ total: sql<number>`count(*)::int` })
        .from(games)
        .where(where),
    ]);

    return {
      total: totalResult[0]?.total ?? 0,
      categories: cats.sort((a, b) => b.count - a.count),
      studios: studios.sort((a, b) => b.count - a.count),
    };
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

  /**
   * Valida los campos económicamente sensibles de `config` (jsonb libre). Por
   * ahora solo `rtp`: si viene, debe ser un número en (0, 1]. Un RTP > 1 (o ≤ 0)
   * haría que la casa pierda estructuralmente en cada ronda (auditoría economía
   * 2026-07). El resto del shape lo validará el provider adapter cuando llegue.
   */
  private assertValidConfig(config: Record<string, unknown> | undefined): void {
    if (!config || config.rtp === undefined) return;
    const rtp = config.rtp;
    if (typeof rtp !== 'number' || !Number.isFinite(rtp) || rtp <= 0 || rtp > 1) {
      throw new GameInvalidConfigError(
        `rtp debe ser un número en (0, 1] (recibido: ${JSON.stringify(rtp)}).`,
      );
    }
  }

  async create(db: TenantDb, dto: CreateGameDto): Promise<Game> {
    this.assertValidConfig(dto.config);
    const values: NewGame = {
      code: dto.code,
      name: dto.name,
      providerCode: dto.providerCode ?? 'palace',
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
    this.assertValidConfig(dto.config);
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
    if (dto.isHidden !== undefined) set.isHidden = dto.isHidden;
    if (dto.isDisabled !== undefined) set.isDisabled = dto.isDisabled;

    const updated = await db
      .update(games)
      .set(set)
      .where(eq(games.id, id))
      .returning();
    return updated[0]!;
  }

  /**
   * Aplica flags (oculto/deshabilitado/destacado) a varios juegos de una.
   * Devuelve cuántos filas se afectaron. Ignora ids inexistentes.
   */
  async bulkSetFlags(
    db: TenantDb,
    ids: string[],
    patch: { isHidden?: boolean; isDisabled?: boolean; featured?: boolean },
  ): Promise<{ affected: number }> {
    if (ids.length === 0) return { affected: 0 };
    const set: Partial<NewGame> = { updatedAt: new Date() };
    if (patch.isHidden !== undefined) set.isHidden = patch.isHidden;
    if (patch.isDisabled !== undefined) set.isDisabled = patch.isDisabled;
    if (patch.featured !== undefined) set.featured = patch.featured;
    // Nada que setear más allá de updatedAt → no-op.
    if (Object.keys(set).length === 1) return { affected: 0 };
    const updated = await db
      .update(games)
      .set(set)
      .where(inArray(games.id, ids))
      .returning({ id: games.id });
    return { affected: updated.length };
  }

  /**
   * Métricas por juego (para la lista admin). Agrega sobre game_rounds:
   * cantidad de rounds, GGR (bet - win, o sea -sum(netAmount) desde la óptica
   * de la casa), y última vez jugado. Batched por los ids de la página.
   */
  async getMetricsForGames(
    db: TenantDb,
    gameIds: string[],
  ): Promise<Record<string, { rounds: number; ggr: string; lastPlayedAt: string | null }>> {
    if (gameIds.length === 0) return {};
    const rows = await db
      .select({
        gameId: gameRounds.gameId,
        rounds: sql<number>`count(*)::int`,
        // GGR de la casa = sum(bet) - sum(win) = -sum(net_amount).
        ggr: sql<string>`COALESCE(-sum(${gameRounds.netAmount}), 0)::text`,
        lastPlayedAt: sql<string | null>`max(${gameRounds.placedAt})`,
      })
      .from(gameRounds)
      .where(inArray(gameRounds.gameId, gameIds))
      .groupBy(gameRounds.gameId);
    const map: Record<string, { rounds: number; ggr: string; lastPlayedAt: string | null }> = {};
    for (const r of rows) {
      map[r.gameId] = {
        rounds: r.rounds,
        ggr: r.ggr,
        lastPlayedAt: r.lastPlayedAt,
      };
    }
    return map;
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
