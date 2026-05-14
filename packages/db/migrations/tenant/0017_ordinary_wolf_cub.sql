CREATE TYPE "public"."tenant_setting_action" AS ENUM('set', 'unset');--> statement-breakpoint
CREATE TABLE "tenant_settings_history" (
	"id" uuid PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"previous_value" jsonb,
	"new_value" jsonb,
	"action" "tenant_setting_action" NOT NULL,
	"changed_by_user_id" uuid,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tenant_settings_history" ADD CONSTRAINT "tenant_settings_history_changed_by_user_id_users_id_fk" FOREIGN KEY ("changed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tenant_settings_history_key_changed_idx" ON "tenant_settings_history" USING btree ("key","changed_at");--> statement-breakpoint
CREATE INDEX "tenant_settings_history_changed_at_idx" ON "tenant_settings_history" USING btree ("changed_at");