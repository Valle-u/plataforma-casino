CREATE TYPE "public"."commission_payout_status" AS ENUM('pending', 'paid', 'failed', 'refunded');--> statement-breakpoint
CREATE TABLE "commission_rules" (
	"id" uuid PRIMARY KEY NOT NULL,
	"role" text NOT NULL,
	"event_type" text NOT NULL,
	"pct" numeric(5, 2) NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "commission_payouts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"source_event_type" text NOT NULL,
	"source_event_id" uuid NOT NULL,
	"beneficiary_user_id" uuid NOT NULL,
	"beneficiary_role_at_time" text NOT NULL,
	"rule_id" uuid,
	"source_amount" numeric(20, 2) NOT NULL,
	"pct" numeric(5, 2) NOT NULL,
	"payout_amount" numeric(20, 2) NOT NULL,
	"wallet_tx_id" uuid,
	"status" "commission_payout_status" DEFAULT 'pending' NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"paid_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "commission_payouts" ADD CONSTRAINT "commission_payouts_beneficiary_user_id_users_id_fk" FOREIGN KEY ("beneficiary_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_payouts" ADD CONSTRAINT "commission_payouts_rule_id_commission_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."commission_rules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_payouts" ADD CONSTRAINT "commission_payouts_wallet_tx_id_wallet_transactions_id_fk" FOREIGN KEY ("wallet_tx_id") REFERENCES "public"."wallet_transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "commission_rules_role_event_unique" ON "commission_rules" USING btree ("role","event_type");--> statement-breakpoint
CREATE INDEX "commission_payouts_beneficiary_created" ON "commission_payouts" USING btree ("beneficiary_user_id","created_at");--> statement-breakpoint
CREATE INDEX "commission_payouts_source" ON "commission_payouts" USING btree ("source_event_type","source_event_id");--> statement-breakpoint
CREATE INDEX "commission_payouts_status_created" ON "commission_payouts" USING btree ("status","created_at");