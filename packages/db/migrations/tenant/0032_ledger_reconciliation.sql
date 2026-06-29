-- Blindaje del núcleo económico (pre-v1) — Parte A: validador de invariante.
--
-- Tabla `ledger_reconciliation_runs`: registro APPEND-ONLY de cada corrida del
-- chequeo "¿las fichas cuadran?". Guarda cuántas wallets se revisaron, cuántas
-- descuadraron (con detalle JSON) y un snapshot del supply de fichas.
-- Ver docs/14-roadmap.md §10.6.

CREATE TABLE "ledger_reconciliation_runs" (
  "id" uuid PRIMARY KEY NOT NULL,
  "run_at" timestamp with time zone NOT NULL DEFAULT now(),
  "trigger" text NOT NULL,
  "triggered_by_user_id" uuid REFERENCES "users"("id"),
  "status" text NOT NULL,
  "wallets_checked" integer NOT NULL DEFAULT 0,
  "wallets_mismatched" integer NOT NULL DEFAULT 0,
  "holds_mismatched" integer NOT NULL DEFAULT 0,
  "mismatches" jsonb,
  "supply" jsonb,
  "duration_ms" integer,
  "error" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "ledger_recon_trigger_valid" CHECK ("trigger" IN ('cron', 'manual')),
  CONSTRAINT "ledger_recon_status_valid" CHECK ("status" IN ('ok', 'mismatch', 'error'))
);

CREATE INDEX "ledger_recon_run_at" ON "ledger_reconciliation_runs" ("run_at");
