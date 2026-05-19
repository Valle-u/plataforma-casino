CREATE TYPE "public"."loss_limit_period_unit" AS ENUM('day', 'week', 'month');--> statement-breakpoint
CREATE TYPE "public"."self_exclusion_status" AS ENUM('active', 'expired', 'revoked');--> statement-breakpoint
CREATE TYPE "public"."self_exclusion_type" AS ENUM('cool_off', 'temporary', 'permanent');--> statement-breakpoint
CREATE TABLE "responsible_gaming_settings" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"deposit_limit_daily" numeric(20, 2),
	"deposit_limit_weekly" numeric(20, 2),
	"deposit_limit_monthly" numeric(20, 2),
	"bet_limit_per_round" numeric(20, 2),
	"loss_limit_period" numeric(20, 2),
	"loss_limit_period_unit" "loss_limit_period_unit",
	"age_confirmed_at" timestamp with time zone,
	"age_confirmed_min" smallint,
	"updated_by_user_id" uuid,
	"updated_by_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "self_exclusions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"type" "self_exclusion_type" NOT NULL,
	"starts_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ends_at" timestamp with time zone,
	"reason" text,
	"created_by_user_id" uuid,
	"revoked_by_user_id" uuid,
	"revoked_at" timestamp with time zone,
	"revoked_reason" text,
	"status" "self_exclusion_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "responsible_gaming_settings" ADD CONSTRAINT "responsible_gaming_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "responsible_gaming_settings" ADD CONSTRAINT "responsible_gaming_settings_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "self_exclusions" ADD CONSTRAINT "self_exclusions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "self_exclusions" ADD CONSTRAINT "self_exclusions_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "self_exclusions" ADD CONSTRAINT "self_exclusions_revoked_by_user_id_users_id_fk" FOREIGN KEY ("revoked_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "self_exclusions_user_active_unique" ON "self_exclusions" USING btree ("user_id") WHERE status = 'active';--> statement-breakpoint
CREATE INDEX "self_exclusions_user_status" ON "self_exclusions" USING btree ("user_id","status");