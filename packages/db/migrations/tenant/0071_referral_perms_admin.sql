-- Migration 0071: Grant referrals.view_own to admin_tenant
-- The seed assigns ALL permissions on tenant creation, but existing tenants
-- that were seeded before migration 0069 are missing the new referral perms.

INSERT INTO "role_permissions" ("role_id", "permission_code")
SELECT r."id", 'referrals.view_own'
FROM "roles" r
WHERE r."code" = 'admin_tenant'
ON CONFLICT DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_code")
SELECT r."id", 'referrals.view_any'
FROM "roles" r
WHERE r."code" = 'admin_tenant'
ON CONFLICT DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_code")
SELECT r."id", 'referrals.create'
FROM "roles" r
WHERE r."code" = 'admin_tenant'
ON CONFLICT DO NOTHING;
