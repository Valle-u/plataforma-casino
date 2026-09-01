-- 0109 · Poder distinguir una ronda que cerró EL PROVEEDOR de una que
--        cerramos NOSOTROS.
--
-- EL PROBLEMA
--
-- Gregmorn manda `round_finished: false` en cada callback de una ronda y, en
-- algunas, el `true` no llega nunca: la ronda queda abierta para siempre. Caso
-- documentado (jugadora `maggie`, 2026-08-29): una compra de tiradas gratis con
-- 30 callbacks, ninguno final, abierta 12+ horas después. Quedaron 3 así.
--
-- Duele en la contabilidad, no en el jugador: al jugador se le cobró la apuesta
-- y se le pagó lo que ganó, todo eso ya está en `wallet_transactions`. Pero la
-- base de comisión sólo cuenta rondas cerradas (LEYES C1/C4b), así que esa
-- NetWin no se le paga al operador. Al 2026-08-31 son 4.172,05 ARS en el limbo,
-- y por eso no se puede liquidar agosto.
--
-- No se puede resolver preguntándoles: su API no tiene ningún endpoint para
-- consultar el estado de una ronda (ver `docs/gregmorn/01-api-spec.md`).
--
-- QUÉ AGREGA ESTA MIGRACIÓN
--
-- Una sola columna, `auto_settled_reason`:
--
--   NULL      → la cerró el proveedor mandando `round_finished: true`. Lo normal.
--   no NULL   → la cerramos nosotros, y acá dice con qué criterio.
--
-- Sin esto el cierre automático sería indistinguible del real: no habría forma
-- de auditar cuántas cerramos por nuestra cuenta, ni de revisarlas el día que
-- el proveedor conteste, ni de revertir si el criterio resultó malo.
--
-- Cerrar una ronda NO mueve plata: sólo cambia `status` y `settled_at`, que es
-- lo que la hace entrar en la base de comisión. Por eso un cierre equivocado es
-- reversible mientras no se haya liquidado el período.
ALTER TABLE game_rounds
  ADD COLUMN IF NOT EXISTS auto_settled_reason text;

COMMENT ON COLUMN game_rounds.auto_settled_reason IS
  'NULL = la cerró el proveedor. No NULL = la cerramos nosotros, con el criterio usado.';

-- Índice parcial para el job que busca rondas abiertas. Parcial y no completo
-- porque las rondas abiertas son POCAS y transitorias: el índice queda chico
-- aunque `game_rounds` crezca a millones de filas. Cubre las dos búsquedas del
-- job: "las abiertas de esta sesión" y "las abiertas más viejas que X".
CREATE INDEX IF NOT EXISTS game_rounds_abiertas
  ON game_rounds (session_id, placed_at)
  WHERE status = 'placed';

-- Mismo criterio para las sesiones activas: hoy NADIE las expira (el estado
-- `expired` existe en el modelo y no lo usa nadie), así que una sesión que el
-- jugador abandonó cerrando la pestaña queda `active` para siempre. El job las
-- va a buscar por antigüedad.
CREATE INDEX IF NOT EXISTS game_sessions_activas
  ON game_sessions (started_at)
  WHERE status = 'active';
