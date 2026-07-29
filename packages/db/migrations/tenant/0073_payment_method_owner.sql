-- Migration 0073: Add owner_id to payment_methods for independent node payment methods.
-- Tenant-level methods keep owner_id = NULL; node-level methods reference the node user.
-- Unique constraints change: code unique per scope (tenant-level vs per-owner).

ALTER TABLE "payment_methods" ADD COLUMN "owner_id" uuid REFERENCES "users"("id") ON DELETE CASCADE;--> statement-breakpoint
DROP INDEX IF EXISTS "payment_methods_code_unique";--> statement-breakpoint
CREATE UNIQUE INDEX "payment_methods_code_unique" ON "payment_methods"("code") WHERE "owner_id" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "payment_methods_owner_code_unique" ON "payment_methods"("owner_id", "code") WHERE "owner_id" IS NOT NULL;
