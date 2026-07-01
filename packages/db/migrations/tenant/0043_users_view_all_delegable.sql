-- users.view_all pasa a delegable: hasta ahora solo el rol admin_tenant lo
-- tenía por default y nadie podía otorgarlo como override. El dueño necesita
-- poder delegarlo a empleados de confianza para que vean todo el tenant
-- (bypassa el scope de red downstream).
--
-- Auditoría no cambia (audit_required=false, sigue siendo lectura).

UPDATE permissions
SET is_delegatable = TRUE,
    description = 'Ver TODOS los usuarios del tenant (bypassa scope: no se limita a la red downstream del actor). Delegable a empleados de confianza que necesitan visibilidad completa.'
WHERE code = 'users.view_all';
