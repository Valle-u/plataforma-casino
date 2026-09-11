-- 0122 · El sobre cerrado del giro: que el jugador pueda comprobar que el
--        premio no se decidio al ver quien era. Ver docs/27-ruleta-diaria.md §8.
--
-- ── Que resuelve ──────────────────────────────────────────────────────────
--
-- El premio lo decide el servidor. Hasta ahora el jugador solo podia creernos:
-- se guardaba el numero aleatorio y el dueno podia auditarlo, pero el jugador
-- no tenia forma de verificar nada por su cuenta.
--
-- Ahora: se guarda una semilla secreta ANTES del giro y se publica su huella.
-- Al girar, el resultado se deriva de esa semilla y la semilla se revela. El
-- jugador comprueba que la semilla da la huella que vio antes, y que esa
-- semilla da el gajo que le salio.
--
-- ── Por que la fila existe antes del giro ─────────────────────────────────
--
-- LO QUE HACE QUE SIRVA ES EL ORDEN. La semilla se compromete antes de que el
-- servidor sepa quien va a girar ni que va a salir. Si se generara en el
-- momento del giro no probaria nada: nada impediria elegirla despues de mirar
-- quien era. Por eso la fila nace cuando el jugador ABRE la ruleta.
--
-- `server_seed` es SECRETO hasta `revealed_at`. Si se filtra antes, el jugador
-- conoce el resultado sin girar y la ruleta deja de ser una ruleta.
--
-- `client_seed` la aporta el jugador. Sin ella, el servidor podria generar
-- muchas semillas y quedarse con la que da el peor premio — el compromiso
-- seguiria siendo valido y la trampa tambien.
CREATE TABLE IF NOT EXISTS promotion_spin_commitments (
  id                uuid PRIMARY KEY,
  promotion_id      uuid NOT NULL REFERENCES promotions(id),
  user_id           uuid NOT NULL REFERENCES users(id),
  day_anchor        text NOT NULL,
  server_seed       text NOT NULL,
  server_seed_hash  text NOT NULL,
  client_seed       text NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  revealed_at       timestamptz
);

-- Un compromiso por jugador y por dia. Es lo que impide pedir muchos y
-- quedarse con el que mas guste.
CREATE UNIQUE INDEX IF NOT EXISTS promotion_spin_commitments_uniq
  ON promotion_spin_commitments (promotion_id, user_id, day_anchor);

CREATE INDEX IF NOT EXISTS promotion_spin_commitments_promo_idx
  ON promotion_spin_commitments (promotion_id);
