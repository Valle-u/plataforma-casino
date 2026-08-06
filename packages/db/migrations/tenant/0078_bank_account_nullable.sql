-- Sprint 53 (decisión dueño): el CBU de origen deja de ser obligatorio
-- para transferencias salientes — con subir el comprobante alcanza.
-- El campo se mantiene para flujos entrantes (matcher del deposit).
ALTER TABLE "bank_transactions" ALTER COLUMN "bank_account" DROP NOT NULL;
