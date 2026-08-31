-- 0107 · Estudio del juego (games.studio), unificado entre proveedores.
--
-- Problema: el filtro por estudio del lobby estaba cableado a Palace --
-- agrupaba por `palace_provider_id`, una columna que solo Palace llena. Los
-- 2.979 juegos de Gregmorn y los 4.791 de Forever quedaban afuera: el jugador
-- no podia filtrarlos por estudio aunque el dato existiera.
--
-- Porque existia y no se usaba: cada proveedor lo manda en un lugar distinto.
--
--   palace     palace_provider_id  -> nombre en tenant_settings
--   gregmorn   config.gregmorn.provider    "Pragmatic", "wazdan"
--   forever    config.forever.vendorCode   "slot-pragmatic"
--
-- Solucion: una columna normalizada que cada sync llena, y un filtro que lee
-- una sola cosa.
--
-- CANONIZACION. Las variantes se agrupan por minusculas y se elige UN nombre
-- visible por estudio:
--
--   1. Gregmorn manda "Pragmatic" (304 juegos) y "pragmatic" (219): el mismo
--      estudio partido en dos chips.
--   2. Forever manda codigos (`slot-pragmatic`), sin mayusculas.
--
-- Se prefiere la variante que TIENE mayusculas -- se lee como nombre propio y
-- no como un code -- y recien despues la mas frecuente. Sin esa preferencia
-- ganaria "pragmatic" (633 de Forever) sobre "Pragmatic" (304 de Gregmorn).
-- Si ninguna variante tiene mayusculas se aplica initcap ("amusnet" ->
-- "Amusnet").
--
-- Cruza proveedores a proposito: al jugador le importa jugar Pragmatic, no por
-- que agregador le llega.
--
-- LIMITE CONOCIDO: Palace dice "Pragmatic Play" y Gregmorn "Pragmatic". Son
-- claves distintas, asi que quedan como dos chips. Unirlos necesita un
-- diccionario de alias por estudio -- fuera de alcance, se resuelve el dia que
-- moleste de verdad.
--
-- Aditiva: ADD COLUMN nullable + un UPDATE de backfill.
ALTER TABLE games
  ADD COLUMN IF NOT EXISTS studio text;

WITH raw AS (
  SELECT
    g.id,
    NULLIF(
      trim(
        CASE g.provider_code
          WHEN 'palace' THEN (
            SELECT s.value ->> (g.palace_provider_id::text)
            FROM tenant_settings s
            WHERE s.key = 'palace.provider_names'
          )
          WHEN 'gregmorn' THEN g.config -> 'gregmorn' ->> 'provider'
          -- `slot-pragmatic` -> `pragmatic`: se saca el prefijo de tipo, no el
          -- estudio. Si el code no matchea el patron queda igual.
          WHEN 'forever' THEN regexp_replace(
            COALESCE(g.config -> 'forever' ->> 'vendorCode', ''), '^[a-z]+-', ''
          )
          ELSE NULL
        END
      ),
      ''
    ) AS raw_studio
  FROM games g
),
variants AS (
  SELECT raw_studio, lower(raw_studio) AS k, COUNT(*) AS n
  FROM raw
  WHERE raw_studio IS NOT NULL
  GROUP BY 1, 2
),
canon AS (
  SELECT DISTINCT ON (k)
    k,
    CASE WHEN raw_studio ~ '[A-Z]' THEN raw_studio ELSE initcap(raw_studio) END AS display
  FROM variants
  ORDER BY k, (raw_studio ~ '[A-Z]') DESC, n DESC, raw_studio
)
UPDATE games g
   SET studio = c.display
  FROM raw r
  JOIN canon c ON c.k = lower(r.raw_studio)
 WHERE g.id = r.id;

-- El lobby agrupa y filtra por estudio en cada carga. Parcial: los juegos sin
-- estudio caen al chip "Otros" y no necesitan indice.
CREATE INDEX IF NOT EXISTS games_studio_idx
  ON games (studio)
  WHERE studio IS NOT NULL;
