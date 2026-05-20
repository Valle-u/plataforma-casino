CREATE TYPE "public"."bank_transaction_direction" AS ENUM('incoming', 'outgoing');--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "is_independent_branch" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "branch_bank_account" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "branch_chips_price_per_unit" numeric(10, 4);--> statement-breakpoint
ALTER TABLE "withdrawals" ADD COLUMN "bank_transaction_id" uuid;--> statement-breakpoint
ALTER TABLE "bank_transactions" ADD COLUMN "direction" "bank_transaction_direction" DEFAULT 'incoming' NOT NULL;--> statement-breakpoint
ALTER TABLE "bank_transactions" ADD COLUMN "matched_withdrawal_id" uuid;