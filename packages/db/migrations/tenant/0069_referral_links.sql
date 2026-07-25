-- Migration 0069: Referral links system
--
-- Adds referral_code columns to users table and creates
-- referral_click_events table for tracking clicks on referral links.
--
-- Phase 1: schema only. No data changes.

-- 1. Add referral_code columns to users (nullable → no break on existing data)
ALTER TABLE "users" ADD COLUMN "referral_code" text;
ALTER TABLE "users" ADD COLUMN "referral_code_generated_at" timestamptz;

-- Unique constraint on referral_code (within tenant)
ALTER TABLE "users" ADD CONSTRAINT "users_referral_code_unique" UNIQUE ("referral_code");

-- 2. Create referral_click_events table
CREATE TABLE "referral_click_events" (
  "id" uuid PRIMARY KEY,
  "referral_code" text NOT NULL,
  "referrer_user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "ip" inet,
  "user_agent" text,
  "referer" text,
  "clicked_at" timestamptz NOT NULL DEFAULT now()
);

-- Indexes for common queries
CREATE INDEX "referral_click_referrer" ON "referral_click_events" ("referrer_user_id", "clicked_at");
CREATE INDEX "referral_click_code" ON "referral_click_events" ("referral_code");

-- 3. Add referral permissions to the permissions table
INSERT INTO "permissions" ("code", "category", "description", "audit_required", "is_delegatable")
VALUES
  ('referrals.view_own', 'referrals', 'Ver métricas y código de referido propio', false, false),
  ('referrals.view_any', 'referrals', 'Ver métricas de referidos de cualquier operador', false, false)
ON CONFLICT ("code") DO NOTHING;

-- 4. Grant referral permissions to roles
-- socio: view_own
INSERT INTO "role_permissions" ("role_id", "permission_code")
SELECT r."id", 'referrals.view_own'
FROM "roles" r
WHERE r."code" = 'socio'
ON CONFLICT DO NOTHING;

-- distribuidor: view_own
INSERT INTO "role_permissions" ("role_id", "permission_code")
SELECT r."id", 'referrals.view_own'
FROM "roles" r
WHERE r."code" = 'distribuidor'
ON CONFLICT DO NOTHING;

-- cajero: view_own
INSERT INTO "role_permissions" ("role_id", "permission_code")
SELECT r."id", 'referrals.view_own'
FROM "roles" r
WHERE r."code" = 'cajero'
ON CONFLICT DO NOTHING;

-- admin_tenant gets view_any (and view_own by virtue of ALL perms)
-- No need to explicitly insert view_any since admin gets ALL permissions
-- via the "assign ALL perms to admin_tenant" logic. But let's be explicit:
INSERT INTO "role_permissions" ("role_id", "permission_code")
SELECT r."id", 'referrals.view_any'
FROM "roles" r
WHERE r."code" = 'admin_tenant'
ON CONFLICT DO NOTHING;
