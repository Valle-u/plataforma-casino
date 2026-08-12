-- Comisiones Fase 2: el rol cajero ve su propia comisión (self-scoped).
-- Grant idempotente del permiso commissions.view al rol cajero.
INSERT INTO "role_permissions" ("role_id", "permission_code")
SELECT r."id", 'commissions.view'
FROM "roles" r
WHERE r."code" = 'cajero'
ON CONFLICT DO NOTHING;
