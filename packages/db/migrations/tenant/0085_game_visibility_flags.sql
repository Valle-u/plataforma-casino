ALTER TABLE "games" ADD COLUMN "is_hidden" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "games" ADD COLUMN "is_disabled" boolean DEFAULT false NOT NULL;
