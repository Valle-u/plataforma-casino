-- Decisión dueño (2026-08-14): los roles `distribuidor` y `cajero` NO pueden
-- descargar CSV. Revoca cualquier permiso de export (`*.export` /
-- `*.export_definitions`) de esos dos roles en tenants existentes. Los tenants
-- nuevos ya no los reciben (seed actualizado). El `socio` y el `admin_tenant`
-- mantienen sus exports. Idempotente (si ya no está, no borra nada).
DELETE FROM "role_permissions" rp
USING "roles" r
WHERE rp."role_id" = r."id"
  AND r."code" IN ('distribuidor', 'cajero')
  AND (
    rp."permission_code" LIKE '%.export'
    OR rp."permission_code" LIKE '%.export_definitions'
  );
