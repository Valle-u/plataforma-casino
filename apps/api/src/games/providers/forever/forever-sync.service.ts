/**
 * ForeverSyncService — sincroniza el catálogo de Forever hacia `games`.
 *
 * Trae vendors (GetVendors) y por cada uno sus juegos (GetVendorGames), y los
 * upserta con `provider_code='forever'`. Los datos específicos de Forever
 * (vendorCode / gameCode) van en `games.config.forever` (jsonb), NO en columnas
 * nuevas (decisión de diseño multi-proveedor, ver docs/forever/99). El `code`
 * interno se namespacea `forever:<vendor>:<game>` para no colisionar con Palace.
 *
 * Sync MANUAL (lo dispara el admin). Best-effort por vendor: si uno falla, se
 * loguea y se sigue con los demás.
 */

import { Injectable, Logger } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { games, type Game, type NewGame } from '@casino/db';
import type { TenantDb } from '../../../tenant-resolver/tenant-context';
import { isUniqueViolation } from '../../../common/pg-error';
import { ForeverClient } from './forever-client';
import { FOREVER_GAME_TYPE, type ForeverVendorGame } from './forever.types';

export interface ForeverSyncResult {
  fetched: number;
  created: number;
  updated: number;
  deactivated: number;
  vendors: number;
}

function mapCategory(gameType: number): Game['category'] {
  // 1 = Slot, 2 = Live Casino (Appendix 4.2). Fallback a slots.
  return gameType === FOREVER_GAME_TYPE.LIVE_CASINO ? 'live' : 'slots';
}

/** `code` interno namespaceado para no chocar con otros proveedores. */
function foreverCode(vendorCode: string, gameCode: string): string {
  return `forever:${vendorCode}:${gameCode}`;
}

@Injectable()
export class ForeverSyncService {
  private readonly logger = new Logger(ForeverSyncService.name);

  constructor(private readonly client: ForeverClient) {}

  async syncGames(db: TenantDb): Promise<ForeverSyncResult> {
    this.logger.log('Iniciando sincronización de catálogo Forever...');
    const vendors = await this.client.getVendors(db);
    this.logger.log(`Forever devolvió ${vendors.length} vendors.`);

    const incomingCodes = new Set<string>();
    let fetched = 0;
    let created = 0;
    let updated = 0;

    for (const vendor of vendors) {
      try {
        const vendorGames = await this.client.getVendorGames(db, vendor.vendorCode);
        for (const g of vendorGames) {
          fetched++;
          const code = foreverCode(vendor.vendorCode, g.gameCode);
          incomingCodes.add(code);
          const result = await this.upsertGame(db, code, vendor.vendorCode, g);
          if (result === 'created') created++;
          else if (result === 'updated') updated++;
        }
      } catch (err) {
        this.logger.warn(
          `Vendor ${vendor.vendorCode} falló en el sync: ${(err as Error).message}`,
        );
      }
    }

    // Desactivar juegos de Forever que ya no vienen en el sync.
    const existing = await db
      .select({ id: games.id, code: games.code })
      .from(games)
      .where(and(eq(games.providerCode, 'forever'), eq(games.isActive, true)));
    const toDeactivate = existing.filter(
      (g) => g.code && !incomingCodes.has(g.code),
    );
    for (const g of toDeactivate) {
      await db
        .update(games)
        .set({ isActive: false, updatedAt: new Date() })
        .where(eq(games.id, g.id));
    }

    const result: ForeverSyncResult = {
      fetched,
      created,
      updated,
      deactivated: toDeactivate.length,
      vendors: vendors.length,
    };
    this.logger.log(
      `Sync Forever completo: ${fetched} juegos (${created} nuevos, ${updated} act., ${toDeactivate.length} baja) de ${vendors.length} vendors.`,
    );
    return result;
  }

  private async upsertGame(
    db: TenantDb,
    code: string,
    vendorCode: string,
    g: ForeverVendorGame,
  ): Promise<'created' | 'updated' | 'noop'> {
    const category = mapCategory(g.gameType);
    const config = {
      forever: { vendorCode, gameCode: g.gameCode, gameType: g.gameType },
    };

    const existing = await db
      .select()
      .from(games)
      .where(eq(games.code, code))
      .limit(1);

    if (existing[0]) {
      await db
        .update(games)
        .set({
          name: g.gameName,
          category,
          thumbnailUrl: g.imageUrl ?? existing[0].thumbnailUrl,
          config,
          isActive: true,
          updatedAt: new Date(),
        })
        .where(eq(games.id, existing[0].id));
      return 'updated';
    }

    const values: NewGame = {
      code,
      name: g.gameName,
      providerCode: 'forever',
      category,
      thumbnailUrl: g.imageUrl ?? null,
      config,
      featured: false,
      sortOrder: 0,
      isActive: true,
    };
    try {
      await db.insert(games).values(values);
      return 'created';
    } catch (err) {
      if (isUniqueViolation(err)) {
        await db
          .update(games)
          .set({ name: g.gameName, category, config, isActive: true, updatedAt: new Date() })
          .where(eq(games.code, code));
        return 'updated';
      }
      throw err;
    }
  }
}
