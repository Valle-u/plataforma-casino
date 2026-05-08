CREATE TABLE "platform_user_sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"user_agent" text,
	"ip" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_reason" text,
	CONSTRAINT "platform_user_sessions_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "platform_user_sessions" ADD CONSTRAINT "platform_user_sessions_user_id_platform_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."platform_users"("id") ON DELETE cascade ON UPDATE no action;