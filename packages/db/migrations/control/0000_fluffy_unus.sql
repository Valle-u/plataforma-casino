CREATE TYPE "public"."tenant_status" AS ENUM('active', 'suspended', 'onboarding', 'deleted');--> statement-breakpoint
CREATE TYPE "public"."platform_user_status" AS ENUM('active', 'suspended');--> statement-breakpoint
CREATE TABLE "tenant_plans" (
	"id" uuid PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"commission_pct" numeric(5, 4) NOT NULL,
	"monthly_fee" numeric(10, 2) DEFAULT '0' NOT NULL,
	"features" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenant_plans_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "tenants" (
	"id" uuid PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"db_name" text NOT NULL,
	"db_host" text DEFAULT 'localhost' NOT NULL,
	"status" "tenant_status" DEFAULT 'onboarding' NOT NULL,
	"plan_id" uuid NOT NULL,
	"contact_email" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "tenants_slug_unique" UNIQUE("slug"),
	CONSTRAINT "tenants_db_name_unique" UNIQUE("db_name")
);
--> statement-breakpoint
CREATE TABLE "tenant_domains" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"domain" text NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenant_domains_domain_unique" UNIQUE("domain")
);
--> statement-breakpoint
CREATE TABLE "platform_users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"display_name" text NOT NULL,
	"two_fa_secret" text,
	"status" "platform_user_status" DEFAULT 'active' NOT NULL,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "platform_users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_plan_id_tenant_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."tenant_plans"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_domains" ADD CONSTRAINT "tenant_domains_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;