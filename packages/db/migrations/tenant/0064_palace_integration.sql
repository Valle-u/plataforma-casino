-- Palace Casino integration (Sprint P-1)
-- Adds: palace_callback_token to control DB (separate migration),
--       palace_user_code + palace_account to users,
--       palace_provider_id + palace_game_symbol to games,
--       new table palace_transactions.

-- Users: Palace user mapping
ALTER TABLE "users" ADD COLUMN "palace_user_code" bigserial;
ALTER TABLE "users" ADD COLUMN "palace_account" text;
CREATE INDEX IF NOT EXISTS "users_palace_account" ON "users" ("palace_account");

-- Games: Palace provider mapping
ALTER TABLE "games" ADD COLUMN "palace_provider_id" integer;
ALTER TABLE "games" ADD COLUMN "palace_game_symbol" text;

-- Palace transactions (espejo de bet_casino del proveedor)
DO $$ BEGIN
  CREATE TYPE "palace_tx_sort" AS ENUM('BET', 'WIN', 'CANCEL');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "palace_tx_status" AS ENUM('OK', 'CANCELED');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS "palace_transactions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "trans_guid" text NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "account" text NOT NULL,
  "game_code" text,
  "game_type" text,
  "round_id" text,
  "sort" "palace_tx_sort" NOT NULL,
  "amount" numeric(20, 2) NOT NULL,
  "status" "palace_tx_status" NOT NULL DEFAULT 'OK',
  "provider_id" integer,
  "type" integer,
  "user_code_ref" bigserial,
  "request_timestamp" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "palace_tx_trans_guid_unique" ON "palace_transactions" ("trans_guid");
CREATE INDEX IF NOT EXISTS "palace_tx_user_created" ON "palace_transactions" ("user_id", "created_at");
CREATE INDEX IF NOT EXISTS "palace_tx_account_trans_guid" ON "palace_transactions" ("account", "trans_guid");