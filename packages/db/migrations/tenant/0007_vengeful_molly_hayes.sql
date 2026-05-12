CREATE TABLE "user_hierarchy" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"parent_user_id" uuid,
	"relation_type" text NOT NULL,
	"since" timestamp with time zone DEFAULT now() NOT NULL,
	"until" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user_hierarchy" ADD CONSTRAINT "user_hierarchy_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_hierarchy" ADD CONSTRAINT "user_hierarchy_parent_user_id_users_id_fk" FOREIGN KEY ("parent_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_hierarchy" ADD CONSTRAINT "user_hierarchy_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "user_hierarchy_one_active_parent" ON "user_hierarchy" USING btree ("user_id") WHERE "user_hierarchy"."until" IS NULL;