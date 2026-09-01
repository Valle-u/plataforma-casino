-- 0110 · Registrar los `getBalance` de Gregmorn.
--
-- EL PROBLEMA
--
-- El 2026-09-01 los jugadores reportaron tres veces el mismo cartel: el juego
-- abre mostrando `CRÉDITO 0,00` cuando el wallet tiene saldo real. Y tres veces
-- fue imposible responder si la culpa era nuestra, porque **el `getBalance` no
-- se registraba en ningún lado**: `gregmorn_transactions` guarda sólo los
-- callbacks que mueven plata, y los logs del contenedor se podan con cada
-- deploy. Quedaba la palabra del proveedor contra la nuestra.
--
-- No es una duda teórica. `handleGetBalance` devuelve `UNKNOWN_PLAYER` si no
-- logra resolver al jugador por su `login`, y en ese caso el juego se queda sin
-- saldo — que es EXACTAMENTE el síntoma reportado. O sea que hay una hipótesis
-- concreta de bug propio que hoy no se puede ni confirmar ni descartar.
--
-- QUÉ AGREGA
--
-- Una fila por cada `getBalance`, con lo que efectivamente contestamos. Con eso
-- el cartel de `CRÉDITO 0,00` pasa a ser una pregunta con respuesta: o consta
-- que devolvimos el saldo correcto (y el problema es de ellos), o consta que
-- fallamos (y es nuestro).
--
-- POR QUÉ UNA TABLA APARTE Y NO `gregmorn_transactions`
--
-- Esa tabla tiene un UNIQUE sobre `idempotency_key` que ES la idempotencia del
-- dinero. El `getBalance` no trae `transactionId` y se repite muchas veces por
-- sesión, así que meterlo ahí obligaría a inventar claves sintéticas y a
-- ensuciar la garantía que protege la plata. No vale la pena.
--
-- CRECIMIENTO
--
-- Se llama al abrir cada juego y, según el estudio, cada tanto durante la
-- partida. Es más chico que el volumen de apuestas, pero crece: si en algún
-- momento molesta, se poda por `created_at` sin perder nada — es un registro de
-- diagnóstico, no contable.

CREATE TABLE IF NOT EXISTS "gregmorn_balance_checks" (
  "id" uuid PRIMARY KEY NOT NULL,
  -- El `login` que ellos mandan. Se guarda SIEMPRE, aunque no resuelva a un
  -- usuario nuestro: si no resolvió, es justamente el dato que hace falta.
  "login" text NOT NULL,
  "user_id" uuid,
  -- El `sessionid` de ellos, como texto: sirve para cruzar con
  -- `game_sessions.provider_session_id` y con `gregmorn_transactions`.
  "session_id" text,
  "game_id" text,
  -- Lo que devolvimos. NULL cuando la respuesta fue un error.
  "balance" numeric(20, 2),
  -- 'ok' | 'unknown_player'
  "result" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "gregmorn_balance_checks"
    ADD CONSTRAINT "gregmorn_balance_checks_user_id_users_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "users"("id")
    ON DELETE SET NULL ON UPDATE NO ACTION;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "gregmorn_balance_checks_creado"
  ON "gregmorn_balance_checks" ("created_at" DESC);
--> statement-breakpoint
-- Para la pregunta típica: "¿qué le contestamos a este jugador a esta hora?"
CREATE INDEX IF NOT EXISTS "gregmorn_balance_checks_login_creado"
  ON "gregmorn_balance_checks" ("login", "created_at" DESC);
