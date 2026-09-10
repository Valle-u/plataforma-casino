-- 0116 · Buscar un jugador por telefono sin importar como se escribio (D4).
--
-- ── El agujero que tapa ────────────────────────────────────────────────────
--
-- `users.phone` es TEXTO LIBRE cargado a mano, y hasta ahora el unico lugar que
-- lo buscaba comparaba el string crudo:
--
--   WHERE users.phone = '3415551234'
--
-- Eso es el freno del alta desde el chat: antes de crear una cuenta, avisa si
-- ese telefono ya lo tiene un jugador. Con una comparacion exacta, el freno
-- NO FRENA NADA en cuanto el numero este escrito distinto — y esta escrito
-- distinto casi siempre:
--
--   3415551234        como se dicta
--   0341 15 555-1234  como esta en la agenda
--   +5493415551234    como lo manda WhatsApp
--
-- Las tres son la misma persona. Sin esto, el operador ve "no hay nadie con ese
-- telefono", da de alta una segunda cuenta, y el saldo del jugador queda
-- partido en dos. Las cuentas no se fusionan.
--
-- ── Por que un indice funcional y no una columna normalizada ───────────────
--
-- Una columna `phone_normalizado` seria mas comoda de consultar, pero se
-- escribe desde la aplicacion: pide backfill sobre `users` —que usa todo el
-- sistema— y a partir de ahi hay que acordarse de mantenerla en cada lugar que
-- toque el telefono. Una que se olvide y el freno vuelve a no frenar.
--
-- El indice funcional no se puede desactualizar: lo mantiene Postgres. Y la
-- normalizacion "de verdad" —el 0, el 15, el 9 de movil— vive en un solo lugar
-- del codigo (`apps/api/src/chat/telefono.ts`), que emite las escrituras
-- posibles ya sin separadores. La consulta compara contra esa lista corta.
--
-- `regexp_replace` de cuatro argumentos es IMMUTABLE, asi que se puede indexar.
--
-- Parcial: la mayoria de los usuarios no tiene telefono cargado y no hay razon
-- para que ocupen lugar en el indice.
CREATE INDEX IF NOT EXISTS users_phone_digitos_idx
  ON users ((regexp_replace(phone, '\D', '', 'g')))
  WHERE phone IS NOT NULL;

-- Lo mismo del lado del CRM: por aca entra el vinculo automatico de D4 cuando
-- llega un mensaje de WhatsApp de un numero desconocido, y por aca busca la
-- ficha el operador.
CREATE INDEX IF NOT EXISTS crm_contacts_phone_digitos_idx
  ON crm_contacts ((regexp_replace(phone, '\D', '', 'g')))
  WHERE phone IS NOT NULL;
