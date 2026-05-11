CREATE TYPE "public"."wallet_tx_type" AS ENUM('mint', 'burn', 'load', 'unload', 'transfer_in', 'transfer_out', 'bet', 'win', 'rollback', 'adjustment', 'bonus_grant', 'bonus_clear', 'bonus_forfeit', 'deposit', 'withdrawal', 'jackpot_win', 'promo_reward', 'league_reward', 'commission_payout', 'fund_reserve', 'fund_release');--> statement-breakpoint
CREATE TABLE "wallets" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"balance" numeric(20, 2) DEFAULT '0' NOT NULL,
	"locked_balance" numeric(20, 2) DEFAULT '0' NOT NULL,
	"currency" text DEFAULT 'CHIPS' NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wallets_balance_nonneg" CHECK ("wallets"."balance" >= 0),
	CONSTRAINT "wallets_locked_balance_nonneg" CHECK ("wallets"."locked_balance" >= 0)
);
--> statement-breakpoint
CREATE TABLE "wallet_transactions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"wallet_id" uuid NOT NULL,
	"type" "wallet_tx_type" NOT NULL,
	"amount" numeric(20, 2) NOT NULL,
	"balance_after" numeric(20, 2) NOT NULL,
	"related_tx_id" uuid,
	"counterparty_user_id" uuid,
	"source" text,
	"reference_id" uuid,
	"idempotency_key" text,
	"created_by" uuid,
	"reason" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wallet_tx_amount_positive" CHECK ("wallet_transactions"."amount" > 0),
	CONSTRAINT "wallet_tx_balance_after_nonneg" CHECK ("wallet_transactions"."balance_after" >= 0)
);
--> statement-breakpoint
CREATE TABLE "wallet_holds" (
	"id" uuid PRIMARY KEY NOT NULL,
	"wallet_id" uuid NOT NULL,
	"amount" numeric(20, 2) NOT NULL,
	"reason" text NOT NULL,
	"related_entity_type" text,
	"related_entity_id" uuid,
	"expires_at" timestamp with time zone,
	"released_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wallet_hold_amount_positive" CHECK ("wallet_holds"."amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "idempotency_keys" (
	"key" text PRIMARY KEY NOT NULL,
	"endpoint" text NOT NULL,
	"request_hash" text NOT NULL,
	"status_code" integer NOT NULL,
	"response_body" jsonb NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_transactions" ADD CONSTRAINT "wallet_transactions_wallet_id_wallets_id_fk" FOREIGN KEY ("wallet_id") REFERENCES "public"."wallets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_transactions" ADD CONSTRAINT "wallet_transactions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_holds" ADD CONSTRAINT "wallet_holds_wallet_id_wallets_id_fk" FOREIGN KEY ("wallet_id") REFERENCES "public"."wallets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "wallets_user_id_unique" ON "wallets" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "wallet_tx_idempotency_key_unique" ON "wallet_transactions" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "wallet_tx_wallet_created" ON "wallet_transactions" USING btree ("wallet_id","created_at");--> statement-breakpoint
CREATE INDEX "wallet_tx_type_created" ON "wallet_transactions" USING btree ("type","created_at");