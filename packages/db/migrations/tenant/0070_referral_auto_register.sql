-- Migration 0070: Referral auto-registration
--
-- Adds referral_attributions table for tracking which players registered
-- via referral links. Also adds 'referrals.create' permission for
-- usuario_final (self-registration) and the age_confirmed_at field
-- required by docs/12 for legal defensibility.

-- 1. Add age_confirmed_at to users (nullable — existing users don't have it)
ALTER TABLE "users" ADD COLUMN "age_confirmed_at" timestamptz;
ALTER TABLE "users" ADD COLUMN "consent_data_processing" boolean DEFAULT false;

-- 2. Create referral_attributions table
CREATE TABLE "referral_attributions" (
  "id" uuid PRIMARY KEY,
  "user_id" uuid NOT NULL UNIQUE REFERENCES "users"("id") ON DELETE cascade,
  "referral_code" text NOT NULL,
  "referrer_user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "attribution_method" text NOT NULL DEFAULT 'click',
  "attributed_at" timestamptz NOT NULL DEFAULT now(),
  "ip" text,
  "user_agent" text,
  "referer" text
);

-- Indexes
CREATE INDEX "referral_attr_referrer" ON "referral_attributions" ("referrer_user_id", "attributed_at");
CREATE INDEX "referral_attr_code" ON "referral_attributions" ("referral_code");

-- 3. Add referral permissions
INSERT INTO "permissions" ("code", "category", "description", "audit_required", "is_delegatable")
VALUES
  ('referrals.create', 'referrals', 'Registrarse vía link de referido (auto-registro público)', false, false)
ON CONFLICT ("code") DO NOTHING;

-- 4. Grant referrals.create to usuario_final
INSERT INTO "role_permissions" ("role_id", "permission_code")
SELECT r."id", 'referrals.create'
FROM "roles" r
WHERE r."code" = 'usuario_final'
ON CONFLICT DO NOTHING;
