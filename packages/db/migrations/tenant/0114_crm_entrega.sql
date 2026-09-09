-- 0114 · Si la respuesta del operador llego o no (etapa 2 del CRM, 2.7).
--
-- Hasta ahora el operador contestaba y el mensaje quedaba guardado, y con eso
-- alcanzaba: el unico canal era el widget web, donde "mandar" es emitir por
-- socket.io a alguien que esta del otro lado en ese momento.
--
-- Con un canal externo eso deja de ser cierto. El mensaje se persiste y RECIEN
-- DESPUES sale para Telegram, que puede rechazarlo: el jugador bloqueo al bot,
-- borro el chat, o el token dejo de servir. Sin registrar el resultado, el
-- operador ve su mensaje en el hilo como cualquier otro y da por hecho que
-- llego. Le esta escribiendo a nadie.
--
-- `delivered_at` YA EXISTIA en la tabla desde que se creo el livechat, y no la
-- usaba nadie. Se le empieza a dar el significado obvio: cuando el proveedor
-- acepto el mensaje. Para el widget web sigue en NULL, porque ahi no hay
-- proveedor que acepte nada.
--
-- Lo que falta es el otro lado: por que NO llego.
--
-- ── Por que una columna de texto y no un booleano ───────────────────────────
--
-- Un `delivered boolean` obliga a elegir entre "todavia no" y "fallo", que son
-- estados distintos, y no dice nada de la causa. El motivo que devuelve
-- Telegram es exactamente lo que el operador necesita leer: "Forbidden: bot was
-- blocked by the user" se acciona (hay que pedirle a la persona que lo
-- desbloquee), "Unauthorized" no (hay que revincular el bot).
--
-- Los tres estados quedan representables sin ambiguedad:
--
--   delivered_at NULL  + delivery_error NULL  -> no aplica, o en camino
--   delivered_at SET   + delivery_error NULL  -> el proveedor lo acepto
--   delivered_at NULL  + delivery_error SET   -> no llego, y por que
--
-- ⚠️ El texto viene de Telegram y se recorta antes de guardarlo. NO lleva el
-- token: todo lo que sale del cliente de Telegram pasa por `taparToken`.
ALTER TABLE crm_messages
  ADD COLUMN IF NOT EXISTS delivery_error text;

-- Para la consulta "que respuestas no llegaron", que es la que va a querer
-- mirar el operador —y eventualmente el parte diario—. Parcial porque las filas
-- con error son una minoria mínima frente a todos los mensajes del livechat.
CREATE INDEX IF NOT EXISTS crm_messages_delivery_error_idx
  ON crm_messages (conversation_id)
  WHERE delivery_error IS NOT NULL;
