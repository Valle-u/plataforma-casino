/**
 * PalaceSyncService — sincroniza el catálogo de juegos de Palace.
 *
 * Trae todos los juegos via Main API (game/all) y los upserta en la
 * tabla `games` del tenant. Los juegos que ya no existen en Palace
 * se marcan como inactivos (soft-delete).
 *
 * Mapeo de categorías:
 *   Palace → Nuestro
 *   "Slots" → "slots"
 *   "Live"  → "live"
 *   "Table" → "table"
 *   otro    → "slots" (fallback)
 */

import { Injectable, Logger } from '@nestjs/common';
import { and, eq, isNotNull } from 'drizzle-orm';
import { games, type Game, type NewGame } from '@casino/db';
import type { TenantDb } from '../../../tenant-resolver/tenant-context';
import { PalaceClient, type PalaceGameItem } from './palace-client';
import { isUniqueViolation } from '../../../common/pg-error';

const CATEGORY_MAP: Record<string, Game['category']> = {
  slots: 'slots',
  slot: 'slots',
  live: 'live',
  table: 'table',
  crash: 'crash',
  mini: 'mini',
};

function mapCategory(palaceCategory: string): Game['category'] {
  const lower = palaceCategory.toLowerCase();
  return CATEGORY_MAP[lower] ?? 'slots';
}

export interface PalaceSyncResult {
  fetched: number;
  created: number;
  updated: number;
  deactivated: number;
}

@Injectable()
export class PalaceSyncService {
  private readonly logger = new Logger(PalaceSyncService.name);

  constructor(private readonly client: PalaceClient) {}

  async syncGames(db: TenantDb): Promise<PalaceSyncResult> {
    this.logger.log('Iniciando sincronización de catálogo Palace...');

    const palGames = await this.client.allGames(db);
    this.logger.log(`Recibidos ${palGames.length} juegos de Palace`);

    const incomingCodes = new Set(palGames.map((g) => g.game_code));

    let created = 0;
    let updated = 0;

    for (const palGame of palGames) {
      const result = await this.upsertGame(db, palGame);
      if (result === 'created') created++;
      else if (result === 'updated') updated++;
    }

    // Desactivar juegos de Palace que ya no vienen en el sync.
    // Incluye juegos demo migrados (providerCode='palace' sin symbols) para
    // evitar que aparezcan como jugables cuando no lo son.
    const existingPalaceGames = await db
      .select({ id: games.id, code: games.code })
      .from(games)
      .where(
        and(
          eq(games.providerCode, 'palace'),
          eq(games.isActive, true),
        ),
      );

    const toDeactivate = existingPalaceGames.filter(
      (g) => g.code && !incomingCodes.has(g.code),
    );

    for (const game of toDeactivate) {
      await db
        .update(games)
        .set({ isActive: false, updatedAt: new Date() })
        .where(eq(games.id, game.id));
    }

    const result: PalaceSyncResult = {
      fetched: palGames.length,
      created,
      updated,
      deactivated: toDeactivate.length,
    };

    this.logger.log(
      `Sync completo: ${result.fetched} traídos, ${result.created} creados, ${result.updated} actualizados, ${result.deactivated} desactivados`,
    );

    return result;
  }

  private async upsertGame(
    db: TenantDb,
    palGame: PalaceGameItem,
  ): Promise<'created' | 'updated' | 'noop'> {
    const existing = await db
      .select()
      .from(games)
      .where(eq(games.code, palGame.game_code))
      .limit(1);

    const category = mapCategory(palGame.category);

    if (existing[0]) {
      // Update: solo campos que pueden cambiar en Palace
      await db
        .update(games)
        .set({
          name: palGame.game_name,
          category,
          thumbnailUrl: palGame.game_image ?? existing[0]!.thumbnailUrl,
          shortDescription: palGame.locale_name ?? existing[0]!.shortDescription,
          isActive: palGame.launch_enable,
          palaceProviderId: palGame.provider_id,
          palaceGameSymbol: palGame.game_code,
          updatedAt: new Date(),
        })
        .where(eq(games.id, existing[0]!.id));
      return 'updated';
    }

    // Create
    const values: NewGame = {
      code: palGame.game_code,
      name: palGame.game_name,
      providerCode: 'palace',
      category,
      thumbnailUrl: palGame.game_image ?? null,
      shortDescription: palGame.locale_name ?? null,
      config: { rtp: 0.95 },
      featured: false,
      sortOrder: 0,
      isActive: palGame.launch_enable,
      palaceProviderId: palGame.provider_id,
      palaceGameSymbol: palGame.game_code,
    };

    try {
      await db.insert(games).values(values);
      return 'created';
    } catch (err) {
      // Si es unique_violation, reintentar como update
      if (isUniqueViolation(err)) {
        await db
          .update(games)
          .set({
            name: palGame.game_name,
            category,
            isActive: palGame.launch_enable,
            updatedAt: new Date(),
          })
          .where(eq(games.code, palGame.game_code));
        return 'updated';
      }
      throw err;
    }
  }
}

// Helper importado arriba en el bloque principal de imports.