-- 0113 · Lo que hace falta para recibir mensajes de afuera (etapa 2 del CRM).
--
-- Tres cosas, todas aditivas:
--
--   1. Un indice UNICO sobre `crm_messages.channel_message_id`, para que un
--      reintento del proveedor no pueda duplicar un mensaje.
--   2. Una tabla de EVENTOS CRUDOS: lo que llego, tal cual, antes de procesarlo.
--   3. `webhook_secret` en los canales, para autenticar quien nos escribe.
--
-- ── 1. IDEMPOTENCIA ─────────────────────────────────────────────────────────
--
-- Telegram y Meta REINTENTAN si tardamos en responder o si respondemos algo que
-- no sea 200. Sin unicidad, un reintento crea el mensaje dos veces y el
-- operador ve al jugador escribiendo duplicado.
--
-- La columna ya existia (`channel_message_id`, desde que se creo el livechat) y
-- NUNCA tuvo indice. Chequearlo desde el codigo no alcanza: dos reintentos
-- simultaneos pasan los dos el SELECT antes de que cualquiera inserte. La
-- unicidad tiene que estar en la base.
--
-- PARCIAL, con `WHERE channel_message_id IS NOT NULL`: los mensajes del widget
-- web no tienen id externo y son todos NULL. Un unique comun trataria a los
-- NULL como distintos entre si (asi funciona SQL), asi que tecnicamente
-- andaria — pero el indice pesaria por cada mensaje del livechat sin dar nada.
CREATE UNIQUE INDEX IF NOT EXISTS crm_messages_channel_message_id_unique
  ON crm_messages (channel_message_id)
  WHERE channel_message_id IS NOT NULL;

-- ── 2. EVENTOS CRUDOS ───────────────────────────────────────────────────────
--
-- Lo que llega del canal, TAL CUAL, guardado ANTES de interpretarlo.
--
-- Por que existe. El orden al recibir un webhook es: guardar el crudo →
-- responder 200 → recien ahi procesar. Si el proceso falla —o el contenedor se
-- reinicia en el medio— el mensaje no se perdio: quedo el crudo y se puede
-- reprocesar. Sin esta tabla, un reinicio en el momento equivocado hace
-- desaparecer el mensaje de una persona real, y no queda rastro de que existio.
--
-- Es tambien el unico lugar donde se puede ver que mando el proveedor cuando
-- algo no cuadra. Un `body` distinto al que esperabamos no se puede depurar
-- contra lo que quedo interpretado.
CREATE TABLE IF NOT EXISTS crm_raw_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- De que canal entro. `restrict` y no `cascade`: borrar un canal no puede
  -- llevarse la evidencia de lo que paso por el.
  channel_id uuid NOT NULL REFERENCES crm_channels(id) ON DELETE RESTRICT,

  -- El id del proveedor, para cortar duplicados ANTES de procesar. Nullable
  -- porque no todo evento trae uno (un `edited_message`, un callback).
  external_id text,

  -- El cuerpo entero, sin tocar.
  payload jsonb NOT NULL,

  -- NULL = todavia no se proceso. Con fecha = ya se convirtio en mensaje.
  -- Buscar los NULL viejos es como se detecta que algo se esta trabando.
  processed_at timestamptz,

  -- Por que fallo, si fallo. Se guarda para poder reprocesar a mano.
  error text,

  received_at timestamptz NOT NULL DEFAULT now()
);

-- El mismo criterio que arriba: un reintento no puede crear dos crudos.
CREATE UNIQUE INDEX IF NOT EXISTS crm_raw_events_external_unique
  ON crm_raw_events (channel_id, external_id)
  WHERE external_id IS NOT NULL;

-- La consulta que importa: "que quedo sin procesar". Parcial, porque los
-- procesados no se buscan nunca por este camino y son la enorme mayoria.
CREATE INDEX IF NOT EXISTS crm_raw_events_pendientes_idx
  ON crm_raw_events (received_at)
  WHERE processed_at IS NULL;

-- ── 3. SECRETO DEL WEBHOOK ──────────────────────────────────────────────────
--
-- Telegram devuelve, en cada update, el `secret_token` que se le registro en
-- `setWebhook`, en el header `X-Telegram-Bot-Api-Secret-Token`. Es lo que
-- distingue un update de Telegram de cualquiera que le pegue a la URL.
--
-- Va en su propia columna y no dentro de `config` a proposito: se compara en
-- CADA request entrante, y una columna se lee sin desarmar un jsonb.
--
-- ⚠️ Esto NO es el token del bot. El token del bot va cifrado adentro de
-- `config` (D20) porque es la credencial que deja actuar COMO el bot. Este
-- secreto solo sirve para verificar quien nos escribe: si se filtra, alguien
-- puede mandarnos mensajes falsos, no leer los reales ni escribir como el bot.
ALTER TABLE crm_channels
  ADD COLUMN IF NOT EXISTS webhook_secret text;
