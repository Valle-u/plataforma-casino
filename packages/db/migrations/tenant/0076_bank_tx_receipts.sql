-- Sprint 52 (decisión dueño): el comprobante de pago reemplaza a la
-- referencia bancaria manual en bank_transactions.
--
--   1. Agrega receipt_url + receipt_storage_key (opcional a nivel DB;
--      OBLIGATORIO a nivel app para direction='outgoing').
--   2. Elimina el campo bank_reference y su índice único (dedupe por
--      (bankAccount, bankReference)) — se reemplaza por dedupe por
--      comprobante (same receipt_storage_key no puede subirse dos veces).
--   3. Crea el índice único de dedupe por receipt_storage_key.

ALTER TABLE "bank_transactions" ADD COLUMN "receipt_url" text;--> statement-breakpoint
ALTER TABLE "bank_transactions" ADD COLUMN "receipt_storage_key" text;--> statement-breakpoint
DROP INDEX IF EXISTS "bank_tx_account_ref_unique";--> statement-breakpoint
ALTER TABLE "bank_transactions" DROP COLUMN IF EXISTS "bank_reference";--> statement-breakpoint
CREATE UNIQUE INDEX "bank_tx_receipt_key_unique" ON "bank_transactions" USING btree ("receipt_storage_key") WHERE "bank_transactions"."receipt_storage_key" IS NOT NULL;
