-- Migration 0072: Account lockout columns
-- Adds failed_login_attempts and locked_until for brute-force protection.

ALTER TABLE "users" ADD COLUMN "failed_login_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "locked_until" timestamp with time zone;
