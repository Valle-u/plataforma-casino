-- Permiso de export CSV de transferencias bancarias + balances por cuenta.
-- Alta en el catálogo + grant al admin_tenant en tenants existentes (los
-- nuevos lo reciben por seed). Fuera de distribuidor/cajero por la misma
-- decisión dueño de la migración 0094 (esos roles no exportan CSV).
INSERT INTO "permissions" ("code", "category", "description", "audit_required", "is_delegatable") VALUES
  ('bank_tx.export', 'bank_tx', 'Exportar transferencias y balances bancarios a CSV', true, true)
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_code")
SELECT r."id", p."code"
FROM "roles" r
CROSS JOIN (VALUES ('bank_tx.export')) AS p("code")
WHERE r."code" = 'admin_tenant'
ON CONFLICT DO NOTHING;
