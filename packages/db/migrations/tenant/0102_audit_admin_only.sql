-- 0102 · El "Registro de actividad" (audit_log) pasa a ser ADMIN-ONLY.
-- (decisión del dueño 2026-08-25)
--
-- Problema: el listado de audit NO está scopeado a la red del actor
-- (audit-log.service.query() arma el WHERE solo con los filtros del cliente).
-- Como la 0047 otorgó `audit.view` a los roles socio y distribuidor, un
-- socio/distribuidor veía el audit_log COMPLETO del tenant: acciones del
-- admin_tenant, de OTRAS redes de socios, IP/userAgent/before/after de todos,
-- y podía filtrar por `?actorUserId=<id>` para espiar selectivamente al admin
-- o a un socio rival. Fuga de aislamiento entre redes.
--
-- Fix (admin-only): se saca `audit.view` de los roles socio y distribuidor.
-- El backend ya exige `audit.view` (audit-log.controller), así que esto lo
-- vuelve admin-only SIN tocar código: el admin_tenant conserva el permiso (lo
-- recibe del set completo), el sidebar (anyPerm audit.view/export) se oculta
-- solo para socio/distri, y una llamada directa al endpoint les da 403.
--
-- No se tocan overrides individuales: si un admin le otorgó `audit.view` a un
-- empleado de confianza por override, ese grant se conserva (es intencional).
-- Revierte el grant de audit.view de la 0047 (bloques B y C).
DELETE FROM role_permissions rp
USING roles r
WHERE rp.role_id = r.id
  AND r.code IN ('socio', 'distribuidor')
  AND rp.permission_code = 'audit.view';
