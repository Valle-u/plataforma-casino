ALTER TABLE "game_providers" ADD COLUMN "commission_fee_pct" numeric(5, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "commission_network_periods" ADD COLUMN "provider_fee" numeric(20, 2) DEFAULT '0' NOT NULL;
