-- 0115 · El tramo: la unidad con la que se mide la atencion (CRM, metricas).
--
-- ── El problema que crea D11 ────────────────────────────────────────────────
--
-- Un hilo por contacto y canal, PARA SIEMPRE. Si Juan escribio en marzo y
-- vuelve en septiembre, es la misma conversacion. Sobre esa unidad, las
-- metricas obvias no significan nada:
--
--   "conversaciones abiertas: 340"      -> son todos los que alguna vez escribieron
--   "la de Juan lleva 6 meses abierta"  -> se resolvio en marzo, volvio ayer
--   "tiempo de respuesta promedio"      -> calculado sobre hilos que duran anios
--
-- Medir sobre la conversacion es medir la antiguedad del cliente, no la calidad
-- de la atencion.
--
-- ── La unidad correcta ──────────────────────────────────────────────────────
--
-- Un TRAMO va desde que alguien escribe estando la conversacion resuelta, hasta
-- que se vuelve a marcar resuelta. Un hilo eterno son muchos tramos cortos, y
-- cada uno se mide solo.
--
-- ── Por que una tabla y no derivarlo al consultar ──────────────────────────
--
-- Circuitos deriva la etapa al mirar y no guarda nada (D22), asi que la
-- pregunta se hace de nuevo aca. La respuesta es la contraria, por un motivo
-- concreto: DERIVAR ESTO ES IMPOSIBLE.
--
-- Un tramo empieza cuando la conversacion estaba resuelta, y `crm_conversations
-- .status` es una sola columna mutable: no hay historia de cuando se marco
-- resuelta. Mirando solo los mensajes no se puede saber donde terminaba un
-- tramo y empezaba el siguiente — se podria adivinar por huecos de tiempo, que
-- es inventar un dato y presentarlo como medido.
--
-- Circuitos deriva el ESTADO ACTUAL, que siempre se puede recalcular. Esto es
-- HISTORIA: pasa una vez y hay que anotarla cuando pasa.
--
-- ⚠️ CONSECUENCIA, y no tiene vuelta: NO HAY BACKFILL. Las conversaciones que
-- ya existen no tienen tramos y no se les pueden inventar. La medicion arranca
-- el dia que esto se instala, y la pantalla lo dice desde cuando mide.
--
-- ── Que abre un tramo y que no ─────────────────────────────────────────────
--
-- Lo abre un mensaje `inbound` (el jugador) o `system` (un aviso de derivacion,
-- D8). Los avisos cuentan a proposito, igual que en el parte diario: un aviso
-- ignorado es exactamente el agujero que dejan D8 y D10 juntos.
--
-- NO lo abre un `outbound`. Si el operador escribe primero, no hay ninguna
-- espera que medir: el tramo tendria primera respuesta instantanea y bajaria la
-- mediana de todos los demas sin que nadie haya atendido mejor.
--
-- Y `first_response_at` solo lo marca un `outbound`. Un aviso del sistema no es
-- una respuesta al jugador.
CREATE TABLE IF NOT EXISTS crm_conversation_segments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL
    REFERENCES crm_conversations(id) ON DELETE CASCADE,

  -- Cuando llego el mensaje que abrio el tramo.
  started_at timestamptz NOT NULL DEFAULT now(),

  -- Cuando el operador contesto por primera vez. NULL = todavia nadie contesto,
  -- que es el unico numero imprescindible de toda la seccion.
  first_response_at timestamptz,

  -- Cuando se marco resuelta. NULL = el tramo sigue abierto.
  resolved_at timestamptz
);

-- ⚠️ UNICO PARCIAL: un tramo abierto por conversacion, garantizado por la base.
--
-- El codigo abre tramo con "si no hay uno abierto, abrilo". Chequearlo desde la
-- aplicacion NO alcanza: dos mensajes que entran a la vez pasan los dos el
-- SELECT antes de que cualquiera inserte, y la conversacion queda con dos
-- tramos abiertos. A partir de ahi todas las medianas mienten y nadie lo nota,
-- porque los numeros siguen siendo plausibles.
--
-- Es la misma leccion que `channel_message_id` en la 0113: lo unico que no
-- tiene carrera es un indice unico.
--
-- Sirve ademas para buscar el tramo abierto de una conversacion, que es la
-- consulta que corre en CADA mensaje que entra.
CREATE UNIQUE INDEX IF NOT EXISTS crm_segments_abierto_idx
  ON crm_conversation_segments (conversation_id)
  WHERE resolved_at IS NULL;

-- Para las metricas: se entra por las conversaciones de una bandeja y se piden
-- los tramos de una ventana de tiempo.
CREATE INDEX IF NOT EXISTS crm_segments_conv_idx
  ON crm_conversation_segments (conversation_id, started_at);
