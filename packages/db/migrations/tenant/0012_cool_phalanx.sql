CREATE TYPE "public"."promotion_scope" AS ENUM('tenant');--> statement-breakpoint
CREATE TYPE "public"."promotion_status" AS ENUM('draft', 'scheduled', 'active', 'closed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."promotion_type" AS ENUM('lottery_tickets', 'lottery_ranking', 'missions', 'daily_wheel', 'login_streak', 'level_chests');--> statement-breakpoint
CREATE TABLE "promotions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"type" "promotion_type" NOT NULL,
	"status" "promotion_status" DEFAULT 'draft' NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"prizes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"draw_at" timestamp with time zone,
	"target_segment" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"visibility" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"scope" "promotion_scope" DEFAULT 'tenant' NOT NULL,
	"funded_by_user_id" uuid NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "promotion_rewards" (
	"id" uuid PRIMARY KEY NOT NULL,
	"promotion_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"prize" jsonb NOT NULL,
	"wallet_tx_id" uuid,
	"bonus_id" uuid,
	"idempotency_key" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "promotions" ADD CONSTRAINT "promotions_funded_by_user_id_users_id_fk" FOREIGN KEY ("funded_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promotions" ADD CONSTRAINT "promotions_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promotion_rewards" ADD CONSTRAINT "promotion_rewards_promotion_id_promotions_id_fk" FOREIGN KEY ("promotion_id") REFERENCES "public"."promotions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promotion_rewards" ADD CONSTRAINT "promotion_rewards_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promotion_rewards" ADD CONSTRAINT "promotion_rewards_wallet_tx_id_wallet_transactions_id_fk" FOREIGN KEY ("wallet_tx_id") REFERENCES "public"."wallet_transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promotion_rewards" ADD CONSTRAINT "promotion_rewards_bonus_id_user_bonuses_id_fk" FOREIGN KEY ("bonus_id") REFERENCES "public"."user_bonuses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "promotions_code_uniq" ON "promotions" USING btree ("code");--> statement-breakpoint
CREATE INDEX "promotions_status_idx" ON "promotions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "promotions_type_status_idx" ON "promotions" USING btree ("type","status");--> statement-breakpoint
CREATE UNIQUE INDEX "promotion_rewards_promo_idem_uniq" ON "promotion_rewards" USING btree ("promotion_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "promotion_rewards_user_granted_idx" ON "promotion_rewards" USING btree ("user_id","granted_at");--> statement-breakpoint
CREATE INDEX "promotion_rewards_promotion_idx" ON "promotion_rewards" USING btree ("promotion_id");