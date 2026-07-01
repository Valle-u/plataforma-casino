-- Tesorería revisión (docs/16-tesoreria.md §12): modelo de PRESUPUESTO
-- controlado sumado al aporte estricto (B-build-3, docs §5.5).
--
-- Cambios en house_capital_injections:
--  1. Un nuevo tipo `type` para distinguir aportes 'capital' (atados a bank_tx,
--     el flujo estricto de B-build-3) del nuevo 'budget' (presupuesto que el
--     admin crea directo, sin bank_tx).
--  2. `bank_transaction_id` pasa a NULLABLE (solo obligatorio para type='capital').
--  3. `reason` obligatorio (motivo del fondeo, requerido en ambos tipos).
--  4. El UNIQUE index sobre bank_transaction_id pasa a PARCIAL (WHERE NOT NULL)
--     para mantener la garantía "1 bank_tx ↔ 1 aporte" solo en 'capital'.
--
-- Backfill: filas existentes son todas 'capital' con reason por defecto.

ALTER TABLE "house_capital_injections"
  ADD COLUMN "type" text NOT NULL DEFAULT 'capital';

ALTER TABLE "house_capital_injections"
  ADD COLUMN "reason" text NOT NULL DEFAULT 'aporte_capital';

-- Sacamos el default de reason: nuevos INSERT deben pasarlo explícito.
ALTER TABLE "house_capital_injections"
  ALTER COLUMN "reason" DROP DEFAULT;

-- bank_transaction_id NULLABLE (solo obligatorio para type='capital').
ALTER TABLE "house_capital_injections"
  ALTER COLUMN "bank_transaction_id" DROP NOT NULL;

-- CHECK: type ∈ {capital, budget}; y capital exige bank_transaction_id.
ALTER TABLE "house_capital_injections"
  ADD CONSTRAINT "house_capital_type_valid"
  CHECK ("type" IN ('capital', 'budget'));

ALTER TABLE "house_capital_injections"
  ADD CONSTRAINT "house_capital_capital_needs_bank_tx"
  CHECK (("type" = 'budget') OR ("bank_transaction_id" IS NOT NULL));

-- UNIQUE parcial: garantiza "1 bank_tx ↔ 1 aporte" pero permite múltiples
-- filas con bank_transaction_id = NULL (los 'budget').
DROP INDEX "house_capital_bank_tx_unique";
CREATE UNIQUE INDEX "house_capital_bank_tx_unique"
  ON "house_capital_injections" ("bank_transaction_id")
  WHERE "bank_transaction_id" IS NOT NULL;
