CREATE TYPE "public"."league_metric" AS ENUM('bet_volume', 'rounds_count', 'gross_won', 'player_netwin', 'score_custom');--> statement-breakpoint
CREATE TYPE "public"."league_period" AS ENUM('daily', 'weekly', 'monthly', 'season', 'custom');--> statement-breakpoint
CREATE TYPE "public"."league_status" AS ENUM('scheduled', 'active', 'closed');--> statement-breakpoint
CREATE TABLE "leagues" (
	"id" uuid PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"period" "league_period" NOT NULL,
	"metric" "league_metric" NOT NULL,
	"metric_config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"prizes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"status" "league_status" DEFAULT 'scheduled' NOT NULL,
	"visibility" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"funded_by_user_id" uuid NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "league_standings" (
	"league_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"score" numeric(20, 4) NOT NULL,
	"position" integer NOT NULL,
	"last_updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "league_standings_league_id_user_id_pk" PRIMARY KEY("league_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "league_results" (
	"id" uuid PRIMARY KEY NOT NULL,
	"league_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"final_position" integer NOT NULL,
	"final_score" numeric(20, 4) NOT NULL,
	"prize" jsonb NOT NULL,
	"wallet_tx_id" uuid,
	"bonus_id" uuid,
	"idempotency_key" text NOT NULL,
	"settled_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "leagues" ADD CONSTRAINT "leagues_funded_by_user_id_users_id_fk" FOREIGN KEY ("funded_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leagues" ADD CONSTRAINT "leagues_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "league_standings" ADD CONSTRAINT "league_standings_league_id_leagues_id_fk" FOREIGN KEY ("league_id") REFERENCES "public"."leagues"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "league_standings" ADD CONSTRAINT "league_standings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "league_results" ADD CONSTRAINT "league_results_league_id_leagues_id_fk" FOREIGN KEY ("league_id") REFERENCES "public"."leagues"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "league_results" ADD CONSTRAINT "league_results_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "league_results" ADD CONSTRAINT "league_results_wallet_tx_id_wallet_transactions_id_fk" FOREIGN KEY ("wallet_tx_id") REFERENCES "public"."wallet_transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "league_results" ADD CONSTRAINT "league_results_bonus_id_user_bonuses_id_fk" FOREIGN KEY ("bonus_id") REFERENCES "public"."user_bonuses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "leagues_code_uniq" ON "leagues" USING btree ("code");--> statement-breakpoint
CREATE INDEX "leagues_status_idx" ON "leagues" USING btree ("status");--> statement-breakpoint
CREATE INDEX "leagues_status_ends_at_idx" ON "leagues" USING btree ("status","ends_at");--> statement-breakpoint
CREATE INDEX "league_standings_league_position_idx" ON "league_standings" USING btree ("league_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "league_results_league_idem_uniq" ON "league_results" USING btree ("league_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "league_results_user_idx" ON "league_results" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "league_results_league_position_idx" ON "league_results" USING btree ("league_id","final_position");