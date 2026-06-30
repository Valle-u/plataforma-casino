-- Comisiones por red (modelo operativo) — C2: motor NetWin.
--
-- Resultado por (operador, período mensual): subNetWin de su sub-red, comisión
-- bruta, carryover encadenado, y payable liquidable. Ver docs/16-tesoreria.md §11.

CREATE TYPE "commission_network_period_status" AS ENUM('accrued', 'paid', 'void');

CREATE TABLE "commission_network_periods" (
	"id" uuid PRIMARY KEY NOT NULL,
	"operator_user_id" uuid NOT NULL,
	"period_start" timestamp with time zone NOT NULL,
	"period_end" timestamp with time zone NOT NULL,
	"sub_net_win" numeric(20, 2) DEFAULT '0' NOT NULL,
	"gross_commission" numeric(20, 2) DEFAULT '0' NOT NULL,
	"carryover_in" numeric(20, 2) DEFAULT '0' NOT NULL,
	"carryover_out" numeric(20, 2) DEFAULT '0' NOT NULL,
	"payable" numeric(20, 2) DEFAULT '0' NOT NULL,
	"rate_snapshot" numeric(5, 2) DEFAULT '0' NOT NULL,
	"status" "commission_network_period_status" DEFAULT 'accrued' NOT NULL,
	"wallet_tx_id" uuid,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "commission_network_periods_payable_nonneg" CHECK ("payable" >= 0)
);

ALTER TABLE "commission_network_periods" ADD CONSTRAINT "commission_network_periods_operator_user_id_users_id_fk" FOREIGN KEY ("operator_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;

ALTER TABLE "commission_network_periods" ADD CONSTRAINT "commission_network_periods_wallet_tx_id_wallet_transactions_id_fk" FOREIGN KEY ("wallet_tx_id") REFERENCES "public"."wallet_transactions"("id") ON DELETE no action ON UPDATE no action;

CREATE UNIQUE INDEX "commission_network_periods_operator_period_unique" ON "commission_network_periods" USING btree ("operator_user_id","period_start");

CREATE INDEX "commission_network_periods_period" ON "commission_network_periods" USING btree ("period_start");
