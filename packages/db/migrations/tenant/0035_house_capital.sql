-- Blindaje del núcleo económico — Parte B (tesorería), B-build-3.
--
-- Aportes de capital del dueño a la Casa, atados a una transferencia bancaria
-- entrante (respaldo real). Es la única forma de crear fichas nuevas: mintea
-- a la wallet de la Casa. Ver docs/16-tesoreria.md §5.5.

ALTER TABLE "bank_transactions" ADD COLUMN "matched_capital_injection_id" uuid;

CREATE TABLE "house_capital_injections" (
  "id" uuid PRIMARY KEY NOT NULL,
  "amount" numeric(20, 2) NOT NULL,
  "bank_transaction_id" uuid NOT NULL REFERENCES "bank_transactions"("id"),
  "mint_tx_id" uuid REFERENCES "wallet_transactions"("id"),
  "created_by" uuid NOT NULL REFERENCES "users"("id"),
  "notes" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "house_capital_amount_positive" CHECK ("amount" > 0)
);

CREATE UNIQUE INDEX "house_capital_bank_tx_unique" ON "house_capital_injections" ("bank_transaction_id");
