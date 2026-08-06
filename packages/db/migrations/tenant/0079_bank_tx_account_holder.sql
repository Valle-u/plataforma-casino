-- Sprint 54 (decisión dueño): sección de transferencias simplificada.
-- La cuenta propia del tenant se modela como titular + banco (varias cuentas
-- guardadas por dispositivo). Estas columnas quedan en cada bank_transaction
-- para verlas en el listado y como dato de auditoría.
ALTER TABLE "bank_transactions" ADD COLUMN "account_holder" text;
ALTER TABLE "bank_transactions" ADD COLUMN "bank_name" text;
