-- D1: comodín `house.set_employee_cap_admin_network` para el patrón admin_network.
--
-- Contexto (audit adversarial): el endpoint PATCH /tenant/correction/user/:userId/cap
-- (CorrectionController.setCap) fija el cupo mensual de correcciones a un empleado.
-- El endpoint solo estaba protegido por @RequirePermissions('users.edit') sin
-- @ScopeTarget, y `users.edit` es auto-grant en INDEPENDENT_BRANCH_AUTO_PERMISSIONS.
-- Resultado: un socio independiente podía subir el cupo a un empleado de la RED
-- DEL ADMIN y drenar la Casa (`__casa__`) hacia players de su propia sub-red.
--
-- Fix (D1): setCap ahora tiene @ScopeTarget('userId','param') + @AdminNetworkBypass
-- de este permiso. El comodín del admin (empleado sin descendencia jerárquica que
-- necesita fijar cupos a empleados de toda la red del admin) usa este alias para
-- pasar el ScopeGuard, restringido a la red del admin (excluye sub-red indep).
--
-- El alias se resuelve a `users.edit` en admin-network-aliases.ts para pasar el
-- gate @RequirePermissions('users.edit').
--
-- Delegable=TRUE (se otorga por override — no viene con ningún rol default).
-- audit_required=TRUE — cambiar cupos de correcciones es medium/alto impacto.

INSERT INTO permissions (code, category, description, audit_required, is_delegatable)
VALUES (
  'house.set_employee_cap_admin_network',
  'house',
  'Fijar el cupo mensual de correcciones a empleados de la red del admin (admin_network). Alias restringido de users.edit para el flujo de setCap: excluye sub-redes de socios independientes. Delegable.',
  TRUE,
  TRUE
)
ON CONFLICT (code) DO UPDATE SET
  category       = EXCLUDED.category,
  description    = EXCLUDED.description,
  audit_required = EXCLUDED.audit_required,
  is_delegatable = EXCLUDED.is_delegatable;
