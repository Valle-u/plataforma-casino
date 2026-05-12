CREATE TYPE "public"."payment_method_type" AS ENUM('bank_transfer', 'crypto', 'other');--> statement-breakpoint
CREATE TYPE "public"."deposit_status" AS ENUM('pending', 'under_review', 'approved', 'rejected', 'expired', 'cancelled');--> statement-breakpoint
CREATE TABLE "payment_methods" (
	"id" uuid PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"type" "payment_method_type" NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deposits" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"method_id" uuid NOT NULL,
	"amount_fiat" numeric(20, 2) NOT NULL,
	"currency_fiat" text NOT NULL,
	"amount_chips" numeric(20, 2) NOT NULL,
	"status" "deposit_status" DEFAULT 'pending' NOT NULL,
	"receipt_url" text,
	"external_ref" text,
	"assigned_to" uuid,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"rejection_reason" text,
	"wallet_tx_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "deposits_amount_fiat_positive" CHECK ("deposits"."amount_fiat" > 0),
	CONSTRAINT "deposits_amount_chips_positive" CHECK ("deposits"."amount_chips" > 0)
);
--> statement-breakpoint
ALTER TABLE "deposits" ADD CONSTRAINT "deposits_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deposits" ADD CONSTRAINT "deposits_method_id_payment_methods_id_fk" FOREIGN KEY ("method_id") REFERENCES "public"."payment_methods"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deposits" ADD CONSTRAINT "deposits_assigned_to_users_id_fk" FOREIGN KEY ("assigned_to") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deposits" ADD CONSTRAINT "deposits_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deposits" ADD CONSTRAINT "deposits_wallet_tx_id_wallet_transactions_id_fk" FOREIGN KEY ("wallet_tx_id") REFERENCES "public"."wallet_transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "payment_methods_code_unique" ON "payment_methods" USING btree ("code");--> statement-breakpoint
CREATE INDEX "deposits_user_status" ON "deposits" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "deposits_assigned_status" ON "deposits" USING btree ("assigned_to","status");--> statement-breakpoint
CREATE INDEX "deposits_status_created" ON "deposits" USING btree ("status","created_at");