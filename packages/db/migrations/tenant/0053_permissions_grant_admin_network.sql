-- D4: comodines `permissions.grant_admin_network` y `permissions.revoke_admin_network`
-- para el patrón admin_network aplicado a los endpoints de override individual.
--
-- Contexto (audit adversarial D4): los endpoints
--   POST /tenant/permission-overrides/grant
--   POST /tenant/permission-overrides/revoke
--   POST /tenant/permission-overrides/clear
-- NO tenían @ScopeTarget. Un socio independiente al que se le otorgara
-- `permissions.grant` podía grantear permisos a users de la RED DEL ADMIN
-- (fuera de su sub-red). El techo (actor debe tener el permiso base) NO
-- era suficiente porque `permissions.grant` es delegable y el socio indep
-- lo obtiene legítimamente para operar dentro de su sub-red.
--
-- Fix (D4): los handlers reciben @ScopeTarget('userId','body') +
-- @AdminNetworkBypass(<comodín>). Con eso el ScopeGuard restringe al
-- socio indep a su sub-red; y el comodín del admin (empleado sin
-- descendencia jerárquica que necesita administrar permisos en toda la
-- red del admin) se otorga por override para pasar el ScopeGuard,
-- restringido a la red del admin (excluye sub-red indep).
--
-- El alias se resuelve a `permissions.grant` / `permissions.revoke` en
-- admin-network-aliases.ts para pasar el gate @RequirePermissions.
--
-- Delegable=TRUE (se otorga por override — no viene con ningún rol default).
-- audit_required=TRUE — mover permisos es SIEMPRE alto impacto.
--
-- Idempotente: ON CONFLICT DO UPDATE actualiza si ya existían.

INSERT INTO permissions (code, category, description, audit_required, is_delegatable)
VALUES (
  'permissions.grant_admin_network',
  'permissions',
  'Otorgar permisos individuales (override grant) a users de la red del admin (Casa, socios dependientes, distribuidores, cajeros, jugadores). NO alcanza a la sub-red del socio independiente. Alias restringido de permissions.grant para el comodín del admin. Delegable.',
  TRUE,
  TRUE
)
ON CONFLICT (code) DO UPDATE SET
  category       = EXCLUDED.category,
  description    = EXCLUDED.description,
  audit_required = EXCLUDED.audit_required,
  is_delegatable = EXCLUDED.is_delegatable;

INSERT INTO permissions (code, category, description, audit_required, is_delegatable)
VALUES (
  'permissions.revoke_admin_network',
  'permissions',
  'Revocar/limpiar permisos individuales (override revoke/clear) a users de la red del admin. NO alcanza a la sub-red del socio independiente. Alias restringido de permissions.revoke para el comodín del admin. Delegable.',
  TRUE,
  TRUE
)
ON CONFLICT (code) DO UPDATE SET
  category       = EXCLUDED.category,
  description    = EXCLUDED.description,
  audit_required = EXCLUDED.audit_required,
  is_delegatable = EXCLUDED.is_delegatable;
