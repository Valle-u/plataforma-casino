ALTER TABLE "platform_users" ADD COLUMN "failed_login_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "platform_users" ADD COLUMN "locked_until" timestamp with time zone;