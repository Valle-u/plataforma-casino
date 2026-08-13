-- Permisos de "Movimientos sospechosos" (fraude interno). Alta en el catálogo
-- + grant al admin_tenant en tenants existentes (los nuevos los reciben por seed).
INSERT INTO "permissions" ("code", "category", "description", "audit_required", "is_delegatable") VALUES
  ('mov_alerts.view',   'fraud', 'Ver alertas de movimientos sospechosos (minteo, cupos, transferencias, cash-out). Delegable a una planilla de confianza.', false, true),
  ('mov_alerts.review', 'fraud', 'Confirmar/descartar alertas de movimientos sospechosos.', true, true),
  ('mov_alerts.run',    'fraud', 'Disparar manualmente el análisis de movimientos sospechosos.', true, true)
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_code")
SELECT r."id", p."code"
FROM "roles" r
CROSS JOIN (VALUES ('mov_alerts.view'), ('mov_alerts.review'), ('mov_alerts.run')) AS p("code")
WHERE r."code" = 'admin_tenant'
ON CONFLICT DO NOTHING;
