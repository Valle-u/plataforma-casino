-- Sprint 55 (decision del dueno): dedupe por contenido del comprobante.
-- Hasta ahora el dedupe era por receipt_storage_key, pero el storage key es un
-- UUID random generado en cada upload -> el MISMO archivo pasaba dos veces.
-- Agregamos receipt_hash = SHA-256 del contenido del archivo (lo calcula el
-- server en /upload-proof) con un indice unico parcial: el mismo archivo no
-- puede respaldar dos depositos ni dos transferencias.
ALTER TABLE "deposits" ADD COLUMN "receipt_hash" text;
CREATE UNIQUE INDEX "deposits_receipt_hash_unique" ON "deposits" ("receipt_hash") WHERE "receipt_hash" IS NOT NULL;
ALTER TABLE "bank_transactions" ADD COLUMN "receipt_hash" text;
CREATE UNIQUE INDEX "bank_tx_receipt_hash_unique" ON "bank_transactions" ("receipt_hash") WHERE "receipt_hash" IS NOT NULL;
