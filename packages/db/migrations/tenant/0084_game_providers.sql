CREATE TABLE "game_providers" (
	"id" uuid PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"display_name" text NOT NULL,
	"is_enabled" boolean DEFAULT true NOT NULL,
	"maintenance_mode" boolean DEFAULT false NOT NULL,
	"last_sync_at" timestamp with time zone,
	"last_sync_ok" boolean,
	"last_sync_result" jsonb,
	"last_ping_at" timestamp with time zone,
	"last_ping_ok" boolean,
	"last_ping_latency_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "game_providers_code_unique" ON "game_providers" USING btree ("code");
