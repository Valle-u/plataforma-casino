-- Vincula cargas/retiros de fichas MANUALES con su transferencia bancaria
-- (trazabilidad). Espeja el patrón de matched_deposit_id / matched_withdrawal_id:
-- apunta al wallet_transaction de la carga (type 'load', bank_tx incoming) o del
-- retiro (type 'unload', bank_tx outgoing). UUID raw (sin FK): wallet_transactions
-- es append-only; la integridad la chequea BankTransactionsService en el match.
ALTER TABLE "bank_transactions" ADD COLUMN "matched_manual_tx_id" uuid;
--> statement-breakpoint
-- Un movimiento manual (load/unload) se concilia con A LO SUMO una transferencia:
-- guard a nivel DB contra doble-match concurrente.
CREATE UNIQUE INDEX IF NOT EXISTS "bank_tx_matched_manual_tx_uniq"
  ON "bank_transactions" ("matched_manual_tx_id")
  WHERE "matched_manual_tx_id" IS NOT NULL;
