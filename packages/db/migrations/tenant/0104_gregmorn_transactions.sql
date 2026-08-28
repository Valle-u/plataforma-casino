-- 0104 · Transacciones del proveedor Gregmorn Hub (gregmorn_transactions).
--
-- Espejo de palace_transactions / forever_transactions. Una fila por callback
-- que MUEVE plata (writeBet y rollback); el getBalance es de solo lectura y no
-- se registra.
--
-- OJO CON LA CLAVE DE IDEMPOTENCIA. Gregmorn manda el rollback con el MISMO
-- transactionId que el bet que revierte ("The rollback transaction matches the
-- bet transaction (same transaction ID)", su spec). Si se usara transaction_id
-- como clave unica, el rollback se veria como duplicado del bet y se
-- descartaria en silencio: el jugador nunca recuperaria la apuesta de una ronda
-- anulada. Por eso la unica es idempotency_key = '<cmd>:<transactionId>', que
-- separa las dos patas. Confirmado con el proveedor el 2026-08-28.
--
-- Aditiva: CREATE TABLE nueva, no toca ninguna tabla ni dato existente.
DO $$ BEGIN
  CREATE TYPE gregmorn_cmd AS ENUM ('writeBet', 'rollback');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS gregmorn_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key text NOT NULL,
  cmd gregmorn_cmd NOT NULL,
  transaction_id text NOT NULL,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  login text NOT NULL,
  session_id text,
  bet numeric(20, 2) NOT NULL DEFAULT '0',
  win numeric(20, 2) NOT NULL DEFAULT '0',
  game_id text,
  round_id text,
  round_finished boolean NOT NULL DEFAULT false,
  info text,
  created_at timestamptz NOT NULL DEFAULT now()
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS gregmorn_tx_idempotency_key_unique
  ON gregmorn_transactions (idempotency_key);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS gregmorn_tx_transaction_id
  ON gregmorn_transactions (transaction_id);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS gregmorn_tx_user_created
  ON gregmorn_transactions (user_id, created_at);
