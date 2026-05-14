CREATE TYPE "public"."fraud_link_status" AS ENUM('suspected', 'confirmed', 'dismissed');--> statement-breakpoint
CREATE TABLE "fraud_signals" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"signal_type" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"weight" numeric(5, 2) NOT NULL,
	"detected_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fraud_account_links" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_a_id" uuid NOT NULL,
	"user_b_id" uuid NOT NULL,
	"score" numeric(5, 2) NOT NULL,
	"signals" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" "fraud_link_status" DEFAULT 'suspected' NOT NULL,
	"reviewed_by_user_id" uuid,
	"reviewed_at" timestamp with time zone,
	"last_updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fraud_account_links_user_order" CHECK ("fraud_account_links"."user_a_id" < "fraud_account_links"."user_b_id")
);
--> statement-breakpoint
ALTER TABLE "fraud_signals" ADD CONSTRAINT "fraud_signals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fraud_account_links" ADD CONSTRAINT "fraud_account_links_user_a_id_users_id_fk" FOREIGN KEY ("user_a_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fraud_account_links" ADD CONSTRAINT "fraud_account_links_user_b_id_users_id_fk" FOREIGN KEY ("user_b_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fraud_account_links" ADD CONSTRAINT "fraud_account_links_reviewed_by_user_id_users_id_fk" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "fraud_signals_user_idx" ON "fraud_signals" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "fraud_signals_type_idx" ON "fraud_signals" USING btree ("signal_type");--> statement-breakpoint
CREATE UNIQUE INDEX "fraud_account_links_pair_uniq" ON "fraud_account_links" USING btree ("user_a_id","user_b_id");--> statement-breakpoint
CREATE INDEX "fraud_account_links_status_score_idx" ON "fraud_account_links" USING btree ("status","score");