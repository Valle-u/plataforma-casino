CREATE TYPE "public"."bonus_scope" AS ENUM('tenant');--> statement-breakpoint
CREATE TYPE "public"."bonus_definition_status" AS ENUM('draft', 'active', 'paused', 'archived');--> statement-breakpoint
CREATE TYPE "public"."bonus_type" AS ENUM('welcome', 'reload', 'cashback', 'manual', 'free_spins', 'no_deposit', 'referral');--> statement-breakpoint
CREATE TYPE "public"."user_bonus_status" AS ENUM('pending', 'active', 'wagering', 'cleared', 'cancelled', 'expired', 'forfeited');--> statement-breakpoint
ALTER TYPE "public"."wallet_tx_type" ADD VALUE 'bonus_funding' BEFORE 'deposit';--> statement-breakpoint
ALTER TYPE "public"."wallet_tx_type" ADD VALUE 'bonus_funding_revert' BEFORE 'deposit';--> statement-breakpoint
CREATE TABLE "bonus_definitions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"type" "bonus_type" NOT NULL,
	"status" "bonus_definition_status" DEFAULT 'draft' NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"wagering" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"expiration_days" integer DEFAULT 30 NOT NULL,
	"segment_filter" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"visibility" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"scope" "bonus_scope" DEFAULT 'tenant' NOT NULL,
	"funded_by_user_id" uuid NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_bonuses" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"definition_id" uuid NOT NULL,
	"granted_amount" numeric(20, 2) NOT NULL,
	"remaining_amount" numeric(20, 2) NOT NULL,
	"status" "user_bonus_status" DEFAULT 'active' NOT NULL,
	"funded_by_user_id" uuid NOT NULL,
	"granted_by_user_id" uuid,
	"grant_idempotency_key" text NOT NULL,
	"funding_tx_id" uuid,
	"reason" text,
	"source_event" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"activated_at" timestamp with time zone,
	"cleared_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bonus_definitions" ADD CONSTRAINT "bonus_definitions_funded_by_user_id_users_id_fk" FOREIGN KEY ("funded_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bonus_definitions" ADD CONSTRAINT "bonus_definitions_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_bonuses" ADD CONSTRAINT "user_bonuses_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_bonuses" ADD CONSTRAINT "user_bonuses_definition_id_bonus_definitions_id_fk" FOREIGN KEY ("definition_id") REFERENCES "public"."bonus_definitions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_bonuses" ADD CONSTRAINT "user_bonuses_funded_by_user_id_users_id_fk" FOREIGN KEY ("funded_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_bonuses" ADD CONSTRAINT "user_bonuses_granted_by_user_id_users_id_fk" FOREIGN KEY ("granted_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "bonus_definitions_code_uniq" ON "bonus_definitions" USING btree ("code");--> statement-breakpoint
CREATE INDEX "bonus_definitions_status_idx" ON "bonus_definitions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "bonus_definitions_type_idx" ON "bonus_definitions" USING btree ("type");--> statement-breakpoint
CREATE UNIQUE INDEX "user_bonuses_grant_idempotency_uniq" ON "user_bonuses" USING btree ("grant_idempotency_key");--> statement-breakpoint
CREATE INDEX "user_bonuses_user_status_idx" ON "user_bonuses" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "user_bonuses_status_expires_idx" ON "user_bonuses" USING btree ("status","expires_at");--> statement-breakpoint
CREATE INDEX "user_bonuses_definition_idx" ON "user_bonuses" USING btree ("definition_id");