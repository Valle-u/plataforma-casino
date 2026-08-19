ALTER TABLE "tenants" ADD COLUMN "forever_agent_code" text;--> statement-breakpoint
CREATE UNIQUE INDEX "tenants_forever_agent_code_unique" ON "tenants" USING btree ("forever_agent_code");