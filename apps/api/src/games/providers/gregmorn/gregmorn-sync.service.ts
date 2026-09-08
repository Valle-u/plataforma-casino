/**
 * GregmornSyncService — sincroniza el catálogo de Gregmorn hacia `games`.
 *
 * Mucho más simple que el de Forever: Gregmorn devuelve **el catálogo entero en
 * una sola llamada** (`getUserGames` por moneda), sin loop de vendors. Los
 * juegos se upsertan con `provider_code='gregmorn'` y lo específico del
 * proveedor va en `games.config.gregmorn` (jsonb).
 *
 * El `gameId` crudo (`integration:provider:game`) se guarda en el config **tal
 * cual**, porque es lo que hay que mandarle a `openGame`. El `games.code`
 * interno, en cambio, se sanitiza: los `:` rompen el ruteo del launch.
 *
 * Perf: upsert en LOTES con `onConflictDoUpdate` — un aggregator tiene miles de
 * juegos y no se insertan de a uno.
 */

import { Injectable, Logger } from '@nestjs/common';
import { and, eq, lt, sql } from 'drizzle-orm';
import { gameProviders, games, type Game, type NewGame } from '@casino/db';
import type { TenantDb } from '../../../tenant-resolver/tenant-context';
import { GregmornClient } from './gregmorn-client';
import { GREGMORN_CODE, type GregmornGameCatalogItem } from './gregmorn.types';

const UPSERT_CHUNK = 500;

export interface GregmornSyncResult {
  /** Moneda con la que se pidió el catálogo. */
  currency: string;
  fetched: number;
  upserted: number;
  deactivated: number;
  /** Cuántos vinieron con `isEnabled: false` (se guardan inactivos). */
  disabledByProvider: number;
  phase?: 'syncing' | 'done';
}

/**
 * Categoría por nombre de estudio.
 *
 * ⚠️ **Heurística, no dato del proveedor.** Su `GameCatalogItem` NO trae tipo de
 * juego — sólo `provider`, el nombre del estudio. Sin eso no hay forma de
 * distinguir una slot de una ruleta en vivo. Está pendiente preguntarles si
 * pueden exponerlo.
 *
 * **El costo de que esto falle no es cosmético como parecía.** El 2026-09-08 los
 * 9.449 juegos de producción estaban catalogados como `slots`: el lobby mostraba
 * "Todos 9449" y "Slots 9449" —dos chips para lo mismo— y **un jugador que
 * quería ruleta en vivo no tenía cómo llegar**. Con casi diez mil juegos y sólo
 * búsqueda por nombre, la categoría es el único camino para el que no sabe de
 * antemano cómo se llama lo que busca.
 *
 * La causa fue una palabra: la lista decía `pragmatic play live` y Gregmorn
 * manda **`Pragmatic Live`**. `includes` no matcheaba, y 84 juegos de casino en
 * vivo quedaban archivados como tragamonedas.
 *
 * Por eso ahora se compara **normalizado** —sin espacios, guiones ni
 * apóstrofos— así `Play'nGO`, `Playngo` y `play n go` son la misma cosa. El
 * emparejamiento no debería depender de cómo escriba el proveedor.
 */
const ESTUDIOS_POR_CATEGORIA: Array<{
  categoria: Game['category'];
  estudios: string[];
}> = [
  {
    categoria: 'live',
    estudios: [
      'evolution',
      'ezugi',
      'pragmaticlive',
      'pragmaticplaylive',
      'playtechlive',
      'vivogaming',
      'atmosfera',
      'luckystreak',
      'livedealers',
      'tvbet',
    ],
  },
  // Spribe es Aviator y compañía: el género "crash" entero.
  { categoria: 'crash', estudios: ['spribe'] },
  {
    // Bingo, keno y los juegos de pesca. No son tragamonedas y meterlos ahí los
    // vuelve invisibles: son de los pocos que alguien busca *por tipo* y no por
    // nombre. Si "Mini" no te parece el lugar, se cambia esta línea.
    categoria: 'mini',
    estudios: ['bingo', 'keno', 'miniduel', 'mininout', 'miniinout', 'fish', 'firekirin', 'fachai'],
  },
];

/** Sin espacios, guiones, apóstrofos ni mayúsculas: `Play'nGO` → `playngo`. */
function normalizarEstudio(nombre: string): string {
  return nombre.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * `table` NO se mapea a propósito: los juegos de mesa (blackjack, ruleta RNG)
 * vienen de estudios mixtos que también hacen slots, así que el nombre del
 * estudio no alcanza para distinguirlos. Marcarlos por estudio metería slots en
 * "Mesa", que es peor que dejarlos donde están.
 */
export function mapCategory(
  providerName: string | null | undefined,
): Game['category'] {
  const nombre = normalizarEstudio(providerName ?? '');
  if (!nombre) return 'slots';
  for (const { categoria, estudios } of ESTUDIOS_POR_CATEGORIA) {
    if (estudios.some((e) => nombre.includes(e))) return categoria;
  }
  return 'slots';
}

/**
 * `code` interno URL-safe. El `gameId` de Gregmorn viene como
 * `integration_a:provider_a:game_001`; los `:` rompen el ruteo, así que se
 * reemplazan. Es una key opaca — el id real vive en `config.gregmorn.gameId`.
 */
function gregmornCode(gameId: string): string {
  const clean = gameId.replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
  return `${GREGMORN_CODE}_${clean}`;
}

// Helpers para el SET de onConflictDoUpdate (referencias a la fila entrante).
function sqlExcluded(column: string) {
  return sql.raw(`excluded."${column}"`);
}
function sqlCoalesceExcluded(column: string) {
  return sql.raw(`COALESCE(excluded."${column}", games."${column}")`);
}

@Injectable()
export class GregmornSyncService {
  private readonly logger = new Logger(GregmornSyncService.name);

  constructor(private readonly client: GregmornClient) {}

  /**
   * Trae el catálogo y lo vuelca a `games`.
   *
   * `currency` default: la del tenant (`game_provider.gregmorn.currency`, ARS).
   * Gregmorn devuelve el catálogo **por moneda**, así que pedirlo con otra
   * puede dar una lista distinta.
   */
  async syncGames(db: TenantDb, opts?: { currency?: string }): Promise<GregmornSyncResult> {
    const startedAt = new Date();
    const settings = await this.client.getSettings(db);
    const currency = opts?.currency?.trim() ? opts.currency.trim() : settings.currency;

    this.logger.log(`Iniciando sincronización de catálogo Gregmorn (${currency})...`);
    await this.reportProgress(db, { currency, fetched: 0 });

    const catalog = await this.client.getUserGames(db, { settings, currency });
    this.logger.log(`Gregmorn devolvió ${catalog.length} juegos para ${currency}.`);

    // Dedupe por `code`: si el catálogo repite un id, gana el último. Sin esto
    // el upsert por lote falla ("ON CONFLICT ... cannot affect row a second time").
    const byCode = new Map<string, NewGame>();
    let disabledByProvider = 0;

    for (const item of catalog) {
      if (!item?.id) continue;
      if (item.isEnabled === false) disabledByProvider++;
      const code = gregmornCode(item.id);
      byCode.set(code, this.toGameRow(code, item, startedAt));
    }

    const rows = [...byCode.values()];
    await this.reportProgress(db, { currency, fetched: rows.length });

    // Upsert en lotes. No pisa los overrides del admin (featured / sortOrder /
    // isHidden / isDisabled) — solo lo que administra el sync. Mismo criterio
    // que el de Forever.
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

    // Dar de baja los juegos de Gregmorn que ya no vinieron: quedaron con
    // `updated_at` anterior al inicio (los upserteados tienen `startedAt`).
    const deactivated = await db
      .update(games)
      .set({ isActive: false, updatedAt: new Date() })
      .where(
        and(
          eq(games.providerCode, GREGMORN_CODE),
          eq(games.isActive, true),
          lt(games.updatedAt, startedAt),
        ),
      )
      .returning({ id: games.id });

    const result: GregmornSyncResult = {
      currency,
      fetched: catalog.length,
      upserted: rows.length,
      deactivated: deactivated.length,
      disabledByProvider,
      phase: 'done',
    };

    this.logger.log(
      `Sync Gregmorn completo (${currency}): ${rows.length} juegos upserteados, ` +
        `${disabledByProvider} deshabilitados por el proveedor, ` +
        `${deactivated.length} dados de baja.`,
    );
    return result;
  }

  private toGameRow(
    code: string,
    item: GregmornGameCatalogItem,
    updatedAt: Date,
  ): NewGame {
    const title = item.title?.trim();
    return {
      code,
      name: title || item.id,
      providerCode: GREGMORN_CODE,
      category: mapCategory(item.provider),
      thumbnailUrl: item.imageUrl?.trim() ? item.imageUrl.trim() : null,
      config: {
        gregmorn: {
          // El id CRUDO, con los `:`. Es lo que espera `openGame.gameId`.
          gameId: item.id,
          provider: item.provider ?? null,
        },
      },
      featured: false,
      sortOrder: 0,
      // Un juego que el proveedor marca deshabilitado entra inactivo: no
      // aparece en el lobby pero queda referenciable por el historial.
      isActive: item.isEnabled !== false,
      updatedAt,
    };
  }

  /** Publica progreso en la fila del proveedor (best-effort, no rompe el sync). */
  private async reportProgress(
    db: TenantDb,
    p: { currency: string; fetched: number },
  ): Promise<void> {
    try {
      await db
        .update(gameProviders)
        .set({ lastSyncResult: { phase: 'syncing', ...p }, updatedAt: new Date() })
        .where(eq(gameProviders.code, GREGMORN_CODE));
    } catch {
      // no-op
    }
  }
}
