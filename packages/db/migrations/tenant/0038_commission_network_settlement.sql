-- Comisiones por red — C3: liquidación (settlement) de socios.
--
-- Columnas para registrar cómo se liquidó cada fila: fichas (transfer) o plata
-- real (quema), con referencia opcional, fecha y quién. Ver docs/16-tesoreria.md §11.

ALTER TABLE "commission_network_periods" ADD COLUMN "settlement_method" text;
ALTER TABLE "commission_network_periods" ADD COLUMN "settlement_reference" text;
ALTER TABLE "commission_network_periods" ADD COLUMN "paid_at" timestamp with time zone;
ALTER TABLE "commission_network_periods" ADD COLUMN "settled_by_user_id" uuid;

ALTER TABLE "commission_network_periods" ADD CONSTRAINT "commission_network_periods_settled_by_user_id_users_id_fk" FOREIGN KEY ("settled_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "commission_network_periods" ADD CONSTRAINT "commission_network_periods_method_valid" CHECK ("settlement_method" IS NULL OR "settlement_method" IN ('chips', 'cash'));
