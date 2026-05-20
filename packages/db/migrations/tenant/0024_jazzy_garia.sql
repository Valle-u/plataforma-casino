CREATE TYPE "public"."bank_transaction_status" AS ENUM('unmatched', 'matched', 'disputed');--> statement-breakpoint
CREATE TABLE "bank_transactions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"bank_account" text NOT NULL,
	"amount" numeric(20, 2) NOT NULL,
	"currency" text DEFAULT 'ARS' NOT NULL,
	"sender_name" text,
	"sender_cbu" text,
	"reference" text,
	"bank_reference" text,
	"received_at" timestamp with time zone NOT NULL,
	"status" "bank_transaction_status" DEFAULT 'unmatched' NOT NULL,
	"uploaded_by" uuid NOT NULL,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"matched_deposit_id" uuid,
	"matched_by" uuid,
	"matched_at" timestamp with time zone,
	"override_reason" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bank_tx_amount_positive" CHECK ("bank_transactions"."amount" > 0)
);
--> statement-breakpoint
ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_matched_deposit_id_deposits_id_fk" FOREIGN KEY ("matched_deposit_id") REFERENCES "public"."deposits"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_matched_by_users_id_fk" FOREIGN KEY ("matched_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bank_tx_uploaded_by_uploaded" ON "bank_transactions" USING btree ("uploaded_by","uploaded_at");--> statement-breakpoint
CREATE INDEX "bank_tx_status_amount" ON "bank_transactions" USING btree ("status","amount");--> statement-breakpoint
CREATE INDEX "bank_tx_matched_deposit" ON "bank_transactions" USING btree ("matched_deposit_id");--> statement-breakpoint
CREATE UNIQUE INDEX "bank_tx_account_ref_unique" ON "bank_transactions" USING btree ("bank_account","bank_reference") WHERE "bank_transactions"."bank_reference" IS NOT NULL;