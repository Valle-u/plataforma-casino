ALTER TABLE "tenants" ADD COLUMN "palace_callback_token" text;--> statement-breakpoint
CREATE UNIQUE INDEX "tenants_palace_callback_token_unique" ON "tenants" USING btree ("palace_callback_token");