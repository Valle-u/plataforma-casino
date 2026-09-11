-- 0117 · Saber si el premio de la ruleta se entrego de verdad, y poder topear
--        el gasto del dia. Ver docs/27-ruleta-diaria.md §6 y §9.
--
-- ── El agujero que tapa ────────────────────────────────────────────────────
--
-- `promotion_rewards` guardaba la fila y se asumia entregada. No lo estaba
-- siempre. Cuando el grant del bono fallaba —planilla sin saldo, definicion
-- inactiva— el awarder lo anotaba en el log, devolvia `bonusId: null`, y la
-- fila se escribia igual: la pantalla tiraba el confetti y el jugador no
-- recibia nada. Un premio a medias se veia IDENTICO a uno entregado, y la
-- unica forma de distinguirlos era leer los logs del servidor.
--
-- Con `free_spins` era peor todavia: no habia entrega posible y la fila
-- igual se escribia.
--
-- ── Por que dos columnas y no un enum de estado ────────────────────────────
--
-- Es el mismo par que ya usa el envio de Telegram desde la 0114
-- (`delivered_at` / `delivery_error`), y conviene que la plataforma cuente lo
-- mismo de la misma forma:
--
--   las dos en NULL  -> pendiente: la fila existe, el premio no se entrego
--   delivered_at     -> entregado
--   delivery_error   -> fallo, y dice por que
--
-- El default es "pendiente" a proposito: una fila recien insertada NO afirma
-- ninguna entrega. Cualquier camino que se olvide de marcarla queda pendiente
-- y visible, en vez de mentir en silencio — que es el bug que esto cierra.
ALTER TABLE promotion_rewards
  ADD COLUMN IF NOT EXISTS delivered_at timestamptz,
  ADD COLUMN IF NOT EXISTS delivery_error text;

-- ── Las filas que ya existian ──────────────────────────────────────────────
--
-- Se marcan entregadas, que es lo que fueron. Pero NO todas: de dos casos
-- sabemos con certeza que no se entregaron, y decir lo contrario seria
-- escribir un dato falso en la unica tabla que responde "que premios dio esta
-- promocion".
--
--   - kind='free_spins': nunca hubo entrega posible.
--   - kind='bonus' sin `bonus_id`: es exactamente la firma del fail-soft.
--
-- El resto (chips con su wallet_tx, try_again que no entrega nada por
-- definicion) si se entregaron.
UPDATE promotion_rewards
   SET delivered_at = granted_at
 WHERE delivered_at IS NULL
   AND NOT (
     prize->>'kind' = 'free_spins'
     OR (prize->>'kind' = 'bonus' AND bonus_id IS NULL)
   );

UPDATE promotion_rewards
   SET delivery_error = 'Backfill 0117: no se entrego (ver docs/27 §9)'
 WHERE delivered_at IS NULL
   AND delivery_error IS NULL;

-- ── El indice del tope ─────────────────────────────────────────────────────
--
-- El tope diario suma los premios de HOY de una promocion, y lo hace EN CADA
-- GIRO. Sin indice esa suma escanea el historial entero de la promocion, que
-- crece todos los dias y no para nunca.
--
-- Se indexa por `metadata->>'dayAnchor'` y no por `granted_at` a proposito.
-- El ancla es la MISMA que define la clave de idempotencia del giro
-- (`daily_spin:<promo>:<user>:<ancla>`), asi que el tope y la regla de "un
-- giro por dia" no pueden discrepar sobre que dia es. Con una ventana de
-- tiempo calculada aparte si podrian: bastaria una diferencia de husos entre
-- los dos calculos para que un giro cuente en un dia y se cobre en otro.
CREATE INDEX IF NOT EXISTS promotion_rewards_promo_dia_idx
  ON promotion_rewards (promotion_id, (metadata->>'dayAnchor'));
