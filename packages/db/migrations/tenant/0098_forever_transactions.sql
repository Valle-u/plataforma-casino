-- Forever (2º proveedor de juegos, seamless) — F2.
-- Tabla forever_transactions: espejo de palace_transactions para el callback
-- ChangeBalance de Forever (txn_type 0=Debit/1=Credit/2=Cancel). Idempotencia
-- por txn_code. Append-only (Forever no tiene command status; el cancel es su
-- propia fila).
-- (El forever_agent_code de la DB de control va en su propia migración de control.)

DO $$ BEGIN
  CREATE TYPE "forever_tx_sort" AS ENUM('BET', 'WIN', 'CANCEL');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS "forever_transactions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "txn_code" text NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "user_code" text NOT NULL,
  "vendor_code" text,
  "txn_type" integer NOT NULL,
  "sort" "forever_tx_sort" NOT NULL,
  "wager_id" text,
  "pair_code" text,
  "amount" numeric(20, 2) NOT NULL,
  "game_code" text,
  "game_round_id" text,
  "is_free_round" integer NOT NULL DEFAULT 0,
  "provider_created_on" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "forever_tx_txn_code_unique" ON "forever_transactions" ("txn_code");
CREATE INDEX IF NOT EXISTS "forever_tx_wager" ON "forever_transactions" ("wager_id");
CREATE INDEX IF NOT EXISTS "forever_tx_user_created" ON "forever_transactions" ("user_id", "created_at");
