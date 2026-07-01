-- Aislamiento red del admin vs sub-red del independiente:
--
-- 1. Revertir users.view_all a NO delegable (el commit 8bc68bd lo hizo delegable
--    pero eso permitía que empleados vean la sub-red del socio independiente,
--    rompiendo el aislamiento del modelo económico).
--
-- 2. Crear users.view_admin_network (DELEGABLE): permiso que expone la red del
--    actor MENOS los subárboles de socios independientes. Ideal para empleados
--    de confianza del admin que operan la Casa + dependientes.
--
-- 3. Asignar el permiso nuevo al rol admin_tenant.
--
-- 4. Revocar overrides de users.view_all creados durante la ventana en la que
--    estuvo delegable (commit 8bc68bd → 8387b7).
--
-- Nota: el auto-grant de la lista ampliada de permisos operativos a socios
-- YA marcados independiente (users.create, wallet.load, deposits.*, etc.) NO
-- se hace en esta migración. Corre en el seed (que es idempotente y ejecuta
-- después de las migraciones), y en cualquier futuro toggleIndependence el
-- service ya inserta el set completo. Para tenants existentes con socios
-- independientes vivos, aplicar el helper `reseedIndependentPermissions` o
-- re-ejecutar el seed (idempotente).

-- (1) Revertir users.view_all a no-delegable
UPDATE permissions
SET is_delegatable = FALSE,
    description = 'Ver TODOS los usuarios del tenant, incluyendo la sub-red de socios independientes (bypassa scope). Solo admin por default; no delegable — para que un empleado vea la red del admin sin invadir la sub-red del independiente, otorgar `users.view_admin_network`.'
WHERE code = 'users.view_all';

-- (2) Crear users.view_admin_network
INSERT INTO permissions (code, category, description, audit_required, is_delegatable)
VALUES (
  'users.view_admin_network',
  'users',
  'Ver la red del admin: Casa + socios dependientes + descendants. NO expone la sub-red de socios independientes (aislamiento del modelo). Delegable a empleados de confianza del admin.',
  FALSE,
  TRUE
)
ON CONFLICT (code) DO NOTHING;

-- (3) Otorgarlo al rol admin_tenant (si el rol ya existe en este punto).
-- La INSERT falla silenciosamente por ON CONFLICT si el rol todavía no
-- está seedeado; el seed corre después e igualmente asigna TODOS los
-- permisos a admin_tenant.
INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, 'users.view_admin_network'
FROM roles r
WHERE r.code = 'admin_tenant'
ON CONFLICT DO NOTHING;

-- (4) Revocar overrides de users.view_all otorgados durante la ventana en la
-- que estuvo delegable. El listado /users va a canalizarse por
-- users.view_admin_network si el dueño lo vuelve a otorgar desde la UI.
DELETE FROM user_permission_overrides
WHERE permission_code = 'users.view_all'
  AND effect = 'grant';
