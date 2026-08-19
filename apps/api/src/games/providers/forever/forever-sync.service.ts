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
  /** Diagnóstico del primer vendor (temporal, para depurar el catálogo). */
  debug?: {
    firstVendor: string;
    responseKeys?: string[];
    gamesCount?: number;
    sampleGame?: unknown;
    error?: string;
  };
}

function mapCategory(gameType: number): Game['category'] {
  // 1 = Slot, 2 = Live Casino (Appendix 4.2). Fallback a slots.
  return gameType === FOREVER_GAME_TYPE.LIVE_CASINO ? 'live' : 'slots';
}

/**
 * `gameName` e `imageUrl` de Forever vienen como JSON de locales
 * (ej. `{"en":"Gates of Olympus"}`). Devuelve el valor del locale preferido
 * (o el primero disponible). Si no es JSON de objeto, devuelve el string tal cual.
 */
function pickLocale(value: string | null | undefined, prefer = 'en'): string | null {
  if (value == null) return null;
  const raw = String(value).trim();
  if (!raw.startsWith('{')) return raw || null;
  try {
    const obj = JSON.parse(raw) as Record<string, unknown>;
    const val = obj[prefer] ?? Object.values(obj)[0];
    return typeof val === 'string' && val.trim() ? val.trim() : null;
  } catch {
    return raw || null;
  }
}

/**
 * `code` interno namespaceado para no chocar con otros proveedores. URL-SAFE:
 * sin `:` (rompen el ruteo a través del rewrite de Next.js + Nest). Se sanitiza
 * a `[A-Za-z0-9_-]` — el code es una key opaca (vendorCode/gameCode reales viven
 * en config.forever), así que la sanitización no afecta el launch.
 */
function foreverCode(vendorCode: string, gameCode: string): string {
  const clean = (s: string) => s.replace(/[^A-Za-z0-9_-]+/g, '-');
  return `forever_${clean(vendorCode)}_${clean(gameCode)}`;
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
    let debug: ForeverSyncResult['debug'];

    for (let i = 0; i < vendors.length; i++) {
      const vendor = vendors[i]!;
      try {
        const raw = await this.client.getVendorGamesRaw(db, vendor.vendorCode);
        const vendorGames = (raw.vendorGames ?? raw.games ?? raw.list ?? []) as ForeverVendorGame[];
        // Diagnóstico: para el primer vendor, guardar las keys de la respuesta y
        // el conteo, así vemos por qué viene vacío sin depender de logs del server.
        if (i === 0) {
          debug = {
            firstVendor: vendor.vendorCode,
            responseKeys: Object.keys(raw),
            gamesCount: vendorGames.length,
            sampleGame: vendorGames[0],
          };
        }
        for (const g of vendorGames) {
          fetched++;
          const code = foreverCode(vendor.vendorCode, g.gameCode);
          incomingCodes.add(code);
          const result = await this.upsertGame(db, code, vendor.vendorCode, g);
          if (result === 'created') created++;
          else if (result === 'updated') updated++;
        }
      } catch (err) {
        const msg = (err as Error).message;
        if (i === 0) debug = { firstVendor: vendor.vendorCode, error: msg };
        this.logger.warn(`Vendor ${vendor.vendorCode} falló en el sync: ${msg}`);
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
      debug,
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
    const name = pickLocale(g.gameName) ?? g.gameCode;
    const thumbnailUrl = pickLocale(g.imageUrl);
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
          name,
          category,
          thumbnailUrl: thumbnailUrl ?? existing[0].thumbnailUrl,
          config,
          isActive: true,
          updatedAt: new Date(),
        })
        .where(eq(games.id, existing[0].id));
      return 'updated';
    }

    const values: NewGame = {
      code,
      name,
      providerCode: 'forever',
      category,
      thumbnailUrl: thumbnailUrl ?? null,
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
