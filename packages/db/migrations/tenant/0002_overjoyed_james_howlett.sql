CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY NOT NULL,
	"actor_user_id" uuid,
	"actor_username" text,
	"actor_role_at_time" text,
	"action_code" text NOT NULL,
	"target_type" text,
	"target_id" text,
	"before" jsonb,
	"after" jsonb,
	"reason" text,
	"metadata" jsonb,
	"ip" text,
	"user_agent" text,
	"request_id" uuid,
	"session_id" uuid,
	"impersonator_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
