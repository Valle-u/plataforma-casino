/**
 * Canonizacion del estudio de cada juego (`games.studio`).
 *
 * El filtro por estudio del lobby estaba cableado a `palace_provider_id`, que
 * solo Palace llena. Aca se unifica el dato de los tres proveedores en una
 * sola columna. Ver migracion 0107 y el comentario de `games.studio`.
 */

import { sql } from 'drizzle-orm';
import type { TenantDb } from '../tenant-resolver/tenant-context';

/**
 * Recalcula `games.studio` para TODOS los juegos, de todos los proveedores.
 *
 * Funcion suelta y no metodo de un service a proposito: la llaman GamesService
 * (lectura) y el flujo de sync (escritura), y GamesService ya inyecta
 * GameProvidersService -- meterla en cualquiera de los dos creaba un ciclo de
 * dependencias por una query que no necesita inyectar nada.
 *
 * Por que mira el catalogo ENTERO y no lo de cada proveedor: la canonizacion
 * cruza proveedores. Si cada sync normalizara lo suyo por separado, Gregmorn
 * produciria `EGT` y Forever `Egt` -- dos chips para el mismo estudio.
 *
 * Misma logica que el backfill de la migracion 0107. Si se tocan las reglas
 * hay que tocar las dos.
 *
 * Idempotente: recomputa desde las fuentes (config / palace_provider_id),
 * nunca desde el valor anterior. Devuelve cuantas filas cambiaron.
 */
export async function refreshStudios(db: TenantDb): Promise<number> {
  const res = await db.execute(sql`
    WITH raw AS (
      SELECT
        g.id,
        NULLIF(trim(CASE g.provider_code
          WHEN 'palace' THEN (
            SELECT s.value ->> (g.palace_provider_id::text)
            FROM tenant_settings s WHERE s.key = 'palace.provider_names'
          )
          WHEN 'gregmorn' THEN g.config -> 'gregmorn' ->> 'provider'
          -- De slot-pragmatic queda pragmatic: saca el prefijo de tipo.
          WHEN 'forever' THEN regexp_replace(
            COALESCE(g.config -> 'forever' ->> 'vendorCode', ''), '^[a-z]+-', ''
          )
          ELSE NULL
        END), '') AS raw_studio
      FROM games g
    ),
    variants AS (
      SELECT raw_studio, lower(raw_studio) AS k, COUNT(*) AS n
      FROM raw WHERE raw_studio IS NOT NULL GROUP BY 1, 2
    ),
    canon AS (
      -- Gana la variante CON mayúsculas (se lee como nombre propio y no
      -- como un code), después la más frecuente. Sin eso ganaría
      -- "pragmatic" (633 de Forever) sobre "Pragmatic" (304 de Gregmorn).
      SELECT DISTINCT ON (k) k,
        CASE WHEN raw_studio ~ '[A-Z]' THEN raw_studio
             ELSE initcap(raw_studio) END AS display
      FROM variants
      ORDER BY k, (raw_studio ~ '[A-Z]') DESC, n DESC, raw_studio
    )
    UPDATE games g
       SET studio = c.display
      FROM raw r JOIN canon c ON c.k = lower(r.raw_studio)
     WHERE g.id = r.id
       AND g.studio IS DISTINCT FROM c.display
  `);
  const changed = (res as unknown as { count?: number }).count ?? 0;
  return changed;
}
