CREATE TYPE "public"."withdrawal_status" AS ENUM('pending', 'approved', 'processing', 'paid', 'rejected', 'failed');--> statement-breakpoint
CREATE TABLE "withdrawals" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"method_id" uuid NOT NULL,
	"amount_chips" numeric(20, 2) NOT NULL,
	"amount_fiat" numeric(20, 2) NOT NULL,
	"currency_fiat" text NOT NULL,
	"target_account" jsonb NOT NULL,
	"status" "withdrawal_status" DEFAULT 'pending' NOT NULL,
	"hold_id" uuid,
	"wallet_tx_id" uuid,
	"assigned_to" uuid,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"rejection_reason" text,
	"paid_external_ref" text,
	"paid_at" timestamp with time zone,
	"failure_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "withdrawals_amount_chips_positive" CHECK ("withdrawals"."amount_chips" > 0),
	CONSTRAINT "withdrawals_amount_fiat_positive" CHECK ("withdrawals"."amount_fiat" > 0)
);
--> statement-breakpoint
ALTER TABLE "withdrawals" ADD CONSTRAINT "withdrawals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "withdrawals" ADD CONSTRAINT "withdrawals_method_id_payment_methods_id_fk" FOREIGN KEY ("method_id") REFERENCES "public"."payment_methods"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "withdrawals" ADD CONSTRAINT "withdrawals_hold_id_wallet_holds_id_fk" FOREIGN KEY ("hold_id") REFERENCES "public"."wallet_holds"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "withdrawals" ADD CONSTRAINT "withdrawals_wallet_tx_id_wallet_transactions_id_fk" FOREIGN KEY ("wallet_tx_id") REFERENCES "public"."wallet_transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "withdrawals" ADD CONSTRAINT "withdrawals_assigned_to_users_id_fk" FOREIGN KEY ("assigned_to") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "withdrawals" ADD CONSTRAINT "withdrawals_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "withdrawals_user_status" ON "withdrawals" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "withdrawals_assigned_status" ON "withdrawals" USING btree ("assigned_to","status");--> statement-breakpoint
CREATE INDEX "withdrawals_status_created" ON "withdrawals" USING btree ("status","created_at");