-- 0106 · Tipo de ronda (game_rounds.action).
--
-- Problema: en "Estadisticas de pago" una compra de tiradas gratis se ve
-- EXACTAMENTE igual que un giro normal. Un `bet` de 5000 dice "Apuesta ·
-- Juego" y nada mas, y los premios de las tiradas siguientes aparecen sin
-- apuesta que los explique, como si salieran de la nada.
--
-- Por que no alcanza con guardar la accion cruda del proveedor: la compra y
-- el giro normal llegan las DOS como `action=spin`. Lo que las distingue es
-- que la compra trae ademas `byBonus` / `freeSpinAdd` en el estado del juego.
-- O sea que el dato util para auditar no es la accion suelta sino el TIPO DE
-- RONDA, que sale de mirar la ronda entera.
--
-- Valores:
--   'bonus_buy'  -> el jugador COMPRO la feature (apuesta grande, y despues
--                   corren tiradas gratis que no vuelven a cobrar).
--   'free_spins' -> la ronda corrio tiradas gratis sin haberlas comprado
--                   (se dispararon solas).
--   'spin'       -> ronda comun.
--   NULL         -> ronda anterior a esta migracion, o proveedor que no
--                   informa nada al respecto (hoy Palace y Forever).
--
-- Se calcula en el callback, donde se sabe con que proveedor se esta
-- hablando, y se va ACTUALIZANDO a medida que llegan las acciones de la
-- ronda: abre como 'spin' o 'bonus_buy', y sube a 'free_spins' si aparece una
-- tirada gratis. `bonus_buy` nunca se pisa -- comprar es mas especifico que
-- que se disparen solas.
--
-- TEXT libre y NULLABLE a proposito, no enum: todavia no conocemos el
-- vocabulario completo de los proveedores (esta preguntado, ver
-- docs/gregmorn/98-pendientes-proveedor.md §2). Un enum obligaria a migrar
-- cada vez que aparece un caso nuevo, y ante un valor inesperado preferimos
-- registrarlo antes que rechazar el callback: la plata ya se movio.
--
-- Aditiva: ADD COLUMN nullable, no toca ninguna fila existente.
ALTER TABLE game_rounds
  ADD COLUMN IF NOT EXISTS action text;

-- Para filtrar por tipo de ronda en los reportes ("mostrame las compras de
-- tiradas gratis"). Parcial: casi todas las filas viejas son NULL y no
-- aportan nada al indice.
CREATE INDEX IF NOT EXISTS game_rounds_action_idx
  ON game_rounds (action)
  WHERE action IS NOT NULL;

-- Indices para el join inverso wallet_transaction -> game_round.
--
-- "Estadisticas de pago" ahora muestra, para cada movimiento de juego, de que
-- ronda salio: que juego, que proveedor, que tipo de jugada. Ese join va por
-- estas tres columnas, que solo tenian la FK -- y en Postgres la FK NO crea
-- indice del lado que referencia. Sin esto cada pagina del listado hace un seq
-- scan de game_rounds, que es la tabla que mas rapido crece (una fila por
-- jugada).
--
-- Parciales: la mayoria de las rondas no tiene rollback, y las viejas pueden no
-- tener los tx enlazados.
CREATE INDEX IF NOT EXISTS game_rounds_bet_wallet_tx_idx
  ON game_rounds (bet_wallet_tx_id)
  WHERE bet_wallet_tx_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS game_rounds_win_wallet_tx_idx
  ON game_rounds (win_wallet_tx_id)
  WHERE win_wallet_tx_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS game_rounds_rollback_wallet_tx_idx
  ON game_rounds (rollback_wallet_tx_id)
  WHERE rollback_wallet_tx_id IS NOT NULL;
