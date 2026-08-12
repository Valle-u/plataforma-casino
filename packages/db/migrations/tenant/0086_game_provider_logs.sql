CREATE TABLE "game_provider_logs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"provider_code" text NOT NULL,
	"event_type" text NOT NULL,
	"severity" text DEFAULT 'info' NOT NULL,
	"message" text NOT NULL,
	"detail" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "game_provider_logs_provider_created" ON "game_provider_logs" USING btree ("provider_code","created_at");--> statement-breakpoint
CREATE INDEX "game_provider_logs_created" ON "game_provider_logs" USING btree ("created_at");
