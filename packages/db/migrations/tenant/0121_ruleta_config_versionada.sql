-- 0121 · Poder reconstruir con que rueda se jugo cada giro.
--        Ver docs/27-ruleta-diaria.md §10.
--
-- ── El agujero que tapa ────────────────────────────────────────────────────
--
-- La config de una promocion es mutable: el admin edita premios y
-- probabilidades con la ruleta prendida y gente girando. Los giros guardaban
-- solo el `segmentId`, asi que al cambiar la config quedaban apuntando a un
-- gajo que ya no existe. El codigo devolvia un segmento sintetico para no
-- explotar — o sea que el historial NO SE PODIA RECONSTRUIR.
--
-- Lo que se pierde con eso no es cosmetico: es la unica respuesta posible a
-- "que probabilidades regian el dia que este jugador no gano nunca". Que es
-- exactamente la pregunta que alguien va a hacer.
--
-- ── Por que por huella y no por numero de version ──────────────────────────
--
-- La config se identifica por el HASH DE SU CONTENIDO, no por un contador:
--
--   1. No se puede desincronizar: la huella se deriva de la config misma.
--   2. No hay carreras: un contador hay que leerlo e incrementarlo, y dos
--      ediciones simultaneas se pisan.
--   3. Dedupe gratis: editar y volver atras vuelve a la misma huella, que es
--      la verdad — es la misma rueda.
--
-- El orden historico sale de `first_seen_at`, no hace falta el contador.
CREATE TABLE IF NOT EXISTS promotion_config_snapshots (
  id             uuid PRIMARY KEY,
  promotion_id   uuid NOT NULL REFERENCES promotions(id),
  config_hash    text NOT NULL,
  config         jsonb NOT NULL,
  first_seen_at  timestamptz NOT NULL DEFAULT now()
);

-- La misma config de la misma promo se guarda UNA vez. Es lo que permite que
-- el insert del giro sea un "si no esta, ponelo" sin leer antes.
CREATE UNIQUE INDEX IF NOT EXISTS promotion_config_snapshots_uniq
  ON promotion_config_snapshots (promotion_id, config_hash);

CREATE INDEX IF NOT EXISTS promotion_config_snapshots_promo_idx
  ON promotion_config_snapshots (promotion_id);

-- ── La huella en cada giro ─────────────────────────────────────────────────
--
-- Se deja NULL en las filas que ya existian. De esas NO SE SABE con que rueda
-- se jugo, y no se inventa: poner la config actual seria afirmar algo falso
-- sobre un giro viejo, que es justo lo que esta columna viene a impedir.
ALTER TABLE promotion_rewards
  ADD COLUMN IF NOT EXISTS config_hash text;
