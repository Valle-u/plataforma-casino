-- Comisiones Fase 4: el distribuidor puede fijar la tasa de sus cajeros
-- (delegación nivel por nivel, LEY C2). Sin este permiso, nadie podía
-- configurar la comisión de un cajero → quedaban en 0% para siempre.
-- Grant idempotente de commissions.configure_network al rol distribuidor.
INSERT INTO "role_permissions" ("role_id", "permission_code")
SELECT r."id", 'commissions.configure_network'
FROM "roles" r
WHERE r."code" = 'distribuidor'
ON CONFLICT DO NOTHING;
