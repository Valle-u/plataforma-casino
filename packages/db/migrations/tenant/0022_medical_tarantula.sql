CREATE TYPE "public"."game_category" AS ENUM('slots', 'live', 'crash', 'table');--> statement-breakpoint
CREATE TYPE "public"."game_session_status" AS ENUM('active', 'closed', 'expired');--> statement-breakpoint
CREATE TYPE "public"."game_round_status" AS ENUM('placed', 'settled', 'rolled_back');--> statement-breakpoint
CREATE TABLE "games" (
	"id" uuid PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"provider_code" text DEFAULT 'mock' NOT NULL,
	"category" "game_category" NOT NULL,
	"thumbnail_url" text,
	"short_description" text,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"featured" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "game_sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"game_id" uuid NOT NULL,
	"provider_session_id" text NOT NULL,
	"currency" text DEFAULT 'CHIPS' NOT NULL,
	"opened_balance" numeric(20, 2) DEFAULT '0' NOT NULL,
	"closing_balance" numeric(20, 2),
	"status" "game_session_status" DEFAULT 'active' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"opened_from_ip" text,
	"opened_from_user_agent" text
);
--> statement-breakpoint
CREATE TABLE "game_rounds" (
	"id" uuid PRIMARY KEY NOT NULL,
	"session_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"game_id" uuid NOT NULL,
	"round_external_id" text NOT NULL,
	"bet_amount" numeric(20, 2) NOT NULL,
	"win_amount" numeric(20, 2) DEFAULT '0' NOT NULL,
	"net_amount" numeric(20, 2) DEFAULT '0' NOT NULL,
	"status" "game_round_status" DEFAULT 'placed' NOT NULL,
	"bet_wallet_tx_id" uuid,
	"win_wallet_tx_id" uuid,
	"rollback_wallet_tx_id" uuid,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"placed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"settled_at" timestamp with time zone,
	"rolled_back_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "game_sessions" ADD CONSTRAINT "game_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_sessions" ADD CONSTRAINT "game_sessions_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_rounds" ADD CONSTRAINT "game_rounds_session_id_game_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."game_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_rounds" ADD CONSTRAINT "game_rounds_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_rounds" ADD CONSTRAINT "game_rounds_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_rounds" ADD CONSTRAINT "game_rounds_bet_wallet_tx_id_wallet_transactions_id_fk" FOREIGN KEY ("bet_wallet_tx_id") REFERENCES "public"."wallet_transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_rounds" ADD CONSTRAINT "game_rounds_win_wallet_tx_id_wallet_transactions_id_fk" FOREIGN KEY ("win_wallet_tx_id") REFERENCES "public"."wallet_transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_rounds" ADD CONSTRAINT "game_rounds_rollback_wallet_tx_id_wallet_transactions_id_fk" FOREIGN KEY ("rollback_wallet_tx_id") REFERENCES "public"."wallet_transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "games_code_unique" ON "games" USING btree ("code");--> statement-breakpoint
CREATE INDEX "games_active_category_sort" ON "games" USING btree ("is_active","category","sort_order");--> statement-breakpoint
CREATE INDEX "games_featured_sort" ON "games" USING btree ("featured","sort_order");--> statement-breakpoint
CREATE INDEX "game_sessions_user_status" ON "game_sessions" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "game_sessions_game_started" ON "game_sessions" USING btree ("game_id","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "game_rounds_session_external_unique" ON "game_rounds" USING btree ("session_id","round_external_id");--> statement-breakpoint
CREATE INDEX "game_rounds_user_placed" ON "game_rounds" USING btree ("user_id","placed_at");--> statement-breakpoint
CREATE INDEX "game_rounds_session_placed" ON "game_rounds" USING btree ("session_id","placed_at");--> statement-breakpoint
CREATE INDEX "game_rounds_game_placed" ON "game_rounds" USING btree ("game_id","placed_at");