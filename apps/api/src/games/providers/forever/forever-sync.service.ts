/**
 * ForeverSyncService — sincroniza el catálogo de Forever hacia `games`.
 *
 * Trae vendors (GetVendors) y por cada uno sus juegos (GetVendorGames), y los
 * upserta con `provider_code='forever'`. Los datos específicos de Forever
 * (vendorCode / gameCode) van en `games.config.forever` (jsonb). El `code`
 * interno es URL-safe `forever_<vendor>_<game>`.
 *
 * Perf: los juegos se insertan en LOTES con `onConflictDoUpdate` (no uno por uno
 * — un aggregator tiene miles de juegos). Publica PROGRESO en la fila del
 * proveedor (game_providers.last_sync_result) para que el panel lo muestre en
 * vivo. Best-effort por vendor: si uno falla, se loguea y se sigue.
 */

import { Injectable, Logger } from '@nestjs/common';
import { and, eq, lt, sql } from 'drizzle-orm';
import { gameProviders, games, type Game, type NewGame } from '@casino/db';
import type { TenantDb } from '../../../tenant-resolver/tenant-context';
import { ForeverClient } from './forever-client';
import { FOREVER_GAME_TYPE, type ForeverVendorGame } from './forever.types';

const UPSERT_CHUNK = 500;

export interface ForeverSyncResult {
  vendors: number;
  fetched: number;
  upserted: number;
  deactivated: number;
  /** Progreso en vivo mientras corre (el panel lo lee). */
  phase?: 'syncing' | 'done';
  vendorsProcessed?: number;
}

function mapCategory(gameType: number): Game['category'] {
  // 1 = Slot, 2 = Live Casino (Appendix 4.2). Fallback a slots.
  return gameType === FOREVER_GAME_TYPE.LIVE_CASINO ? 'live' : 'slots';
}

/**
 * `gameName` e `imageUrl` de Forever vienen como JSON de locales
 * (ej. `{"en":"Gates of Olympus"}`). Devuelve el valor del locale preferido
 * (o el primero). Si no es JSON de objeto, devuelve el string tal cual.
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

/** `code` interno URL-safe (sin `:`, que rompe el ruteo). Key opaca. */
function foreverCode(vendorCode: string, gameCode: string): string {
  const clean = (s: string) => s.replace(/[^A-Za-z0-9_-]+/g, '-');
  return `forever_${clean(vendorCode)}_${clean(gameCode)}`;
}

// Helpers para el SET de onConflictDoUpdate (referencias a la fila entrante).
function sqlExcluded(column: string) {
  return sql.raw(`excluded."${column}"`);
}
function sqlCoalesceExcluded(column: string) {
  return sql.raw(`COALESCE(excluded."${column}", games."${column}")`);
}

@Injectable()
export class ForeverSyncService {
  private readonly logger = new Logger(ForeverSyncService.name);

  constructor(private readonly client: ForeverClient) {}

  async syncGames(db: TenantDb): Promise<ForeverSyncResult> {
    const startedAt = new Date();
    this.logger.log('Iniciando sincronización de catálogo Forever...');
    const vendors = await this.client.getVendors(db);
    const totalVendors = vendors.length;
    this.logger.log(`Forever devolvió ${totalVendors} vendors.`);
    await this.reportProgress(db, { vendors: totalVendors, vendorsProcessed: 0, fetched: 0 });

    const byCode = new Map<string, NewGame>();

    for (let i = 0; i < vendors.length; i++) {
      const vendor = vendors[i]!;
      try {
        const vendorGames = await this.client.getVendorGames(db, vendor.vendorCode);
        for (const g of vendorGames) {
          const code = foreverCode(vendor.vendorCode, g.gameCode);
          byCode.set(code, this.toGameRow(code, vendor.vendorCode, g, startedAt));
        }
      } catch (err) {
        this.logger.warn(
          `Vendor ${vendor.vendorCode} falló en el sync: ${(err as Error).message}`,
        );
      }
      // Progreso cada vendor (best-effort).
      await this.reportProgress(db, {
        vendors: totalVendors,
        vendorsProcessed: i + 1,
        fetched: byCode.size,
      });
    }

    const rows = [...byCode.values()];

    // Upsert en lotes (onConflictDoUpdate por games.code). No pisa overrides del
    // admin (featured/sortOrder/isHidden/isDisabled) — solo actualiza lo del sync.
    for (let i = 0; i < rows.length; i += UPSERT_CHUNK) {
      const chunk = rows.slice(i, i + UPSERT_CHUNK);
      await db
        .insert(games)
        .values(chunk)
        .onConflictDoUpdate({
          target: games.code,
          set: {
            name: sqlExcluded('name'),
            category: sqlExcluded('category'),
            // Mantener la thumbnail vieja si la nueva viene null.
            thumbnailUrl: sqlCoalesceExcluded('thumbnail_url'),
            config: sqlExcluded('config'),
            isActive: sqlExcluded('is_active'),
            updatedAt: startedAt,
          },
        });
    }

    // Desactivar los juegos de Forever que ya no vinieron en este sync: los que
    // quedaron con updated_at ANTERIOR al inicio (los upserteados tienen startedAt).
    const deactivated = await db
      .update(games)
      .set({ isActive: false, updatedAt: new Date() })
      .where(
        and(
          eq(games.providerCode, 'forever'),
          eq(games.isActive, true),
          lt(games.updatedAt, startedAt),
        ),
      )
      .returning({ id: games.id });

    const result: ForeverSyncResult = {
      vendors: totalVendors,
      fetched: rows.length,
      upserted: rows.length,
      deactivated: deactivated.length,
      phase: 'done',
      vendorsProcessed: totalVendors,
    };
    this.logger.log(
      `Sync Forever completo: ${rows.length} juegos de ${totalVendors} vendors, ${deactivated.length} dados de baja.`,
    );
    return result;
  }

  private toGameRow(
    code: string,
    vendorCode: string,
    g: ForeverVendorGame,
    updatedAt: Date,
  ): NewGame {
    return {
      code,
      name: pickLocale(g.gameName) ?? g.gameCode,
      providerCode: 'forever',
      category: mapCategory(g.gameType),
      thumbnailUrl: pickLocale(g.imageUrl),
      config: { forever: { vendorCode, gameCode: g.gameCode, gameType: g.gameType } },
      featured: false,
      sortOrder: 0,
      isActive: true,
      updatedAt,
    };
  }

  /** Publica progreso en la fila del proveedor (best-effort, no rompe el sync). */
  private async reportProgress(
    db: TenantDb,
    p: { vendors: number; vendorsProcessed: number; fetched: number },
  ): Promise<void> {
    try {
      await db
        .update(gameProviders)
        .set({
          lastSyncResult: { phase: 'syncing', ...p },
          updatedAt: new Date(),
        })
        .where(eq(gameProviders.code, 'forever'));
    } catch {
      // no-op
    }
  }
}

