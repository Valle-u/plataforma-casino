-- 0105 · Clawback de rondas anuladas despues de liquidar (commission_network_periods).
--
-- Problema: si el proveedor anula una ronda de un periodo que ya se pago, la
-- comision de esa jugada ya salio de la tesoreria y no hay forma de deshacerla.
-- Hasta ahora simplemente se perdia: el operador cobro por una jugada que no
-- existio, y nada lo registraba.
--
-- Solucion: la ronda se descuenta del periodo donde cae su `rolled_back_at`,
-- como si nunca hubiera existido. El monto va en su propia columna en vez de
-- mezclarse en `sub_net_win`, con el mismo criterio que `provider_fee` (LEY
-- C4b): sin columna propia, un mes con clawback muestra una base mas chica y no
-- hay manera de auditar por que.
--
-- Aditiva: ADD COLUMN con default 0, no toca ninguna fila existente.
ALTER TABLE commission_network_periods
  ADD COLUMN IF NOT EXISTS clawback numeric(20, 2) NOT NULL DEFAULT '0';
